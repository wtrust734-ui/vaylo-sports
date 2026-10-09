// ============================================================================
// PUSH REGISTRATION
// ----------------------------------------------------------------------------
// The app has had a notifications table, a notification_prefs table and a prefs
// screen since June, and no delivery: a notification only ever existed inside
// the app, for an athlete who had already opened it. A streak about to break, a
// challenge closing tonight, a friend beating a PB — all invisible until the
// athlete happened to look.
//
// This is the client half of fixing that. It resolves the device's FCM token
// through the native plugin, stores it against the signed-in athlete, and
// removes it on sign-out.
//
// The states are distinct on purpose, because collapsing them into a single
// "notifications failed" is what makes an app get deleted:
//   registered   — the token is stored against this athlete's account.
//   unconfigured — this build has no Firebase project. Nothing was ever going
//                  to be delivered, and saying so is honest rather than
//                  pretending a device is registered when it is not.
//   denied       — the athlete said no. Asking again is nagging.
//   unsupported  — no native push here at all (a browser).
//   failed       — something did go wrong, and the caller may say so.
//
// A token is a delivery address, so it is treated as a secret: it goes straight
// to the database over the authenticated client and is never logged, never put
// in a URL, and never shown.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { isNative, loadPlugin } from "@/lib/platform";

/** Must match PushChannels.kt. A channel id cannot be renamed after creation. */
export const PUSH_CHANNEL_DEFAULT = "vaylo_default";
export const PUSH_CHANNEL_REMINDERS = "vaylo_reminders";

export type PushOutcome =
  | { status: "registered"; token: string }
  | { status: "unconfigured" }
  | { status: "denied" }
  | { status: "unsupported" }
  | { status: "failed"; error: unknown };

interface PushPlugin {
  register: (options?: Record<string, unknown>) => Promise<{
    configured?: boolean;
    permission?: string;
    token?: string | null;
  }>;
  status: () => Promise<{ configured?: boolean; permission?: string }>;
  unregister: () => Promise<unknown>;
}

let pushPlugin: PushPlugin | null | undefined;

/**
 * This device's token, kept so sign-out can delete exactly one registration.
 *
 * It is also why unregister does not simply "delete my rows": an athlete with
 * a phone and a tablet would have the tablet go deaf on signing out of the
 * phone. The token is the only thing that identifies this install.
 *
 * localStorage, not the database: it has to be readable before there is a
 * session, because that is exactly when it is needed.
 */
const TOKEN_KEY = "vaylo.pushToken";

const readToken = (): string | null => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

const rememberToken = (token: string | null) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode; sign-out falls back to the native unregister */
  }
};

/** Resolved once: `undefined` untried, `null` unavailable on this platform. */
async function getPush(): Promise<PushPlugin | null> {
  if (pushPlugin !== undefined) return pushPlugin;
  if (!isNative()) {
    pushPlugin = null;
    return pushPlugin;
  }
  pushPlugin = await loadPlugin<PushPlugin>("VayloPush");
  return pushPlugin;
}

/**
 * Whether this build can deliver push at all.
 *
 * False on the web (no FCM there yet), false when the native plugin is
 * missing, and false — importantly — when the build has no Firebase project
 * configured. The prefs screen shows a different explanation for each, because
 * "notifications don't work" with no reason is the kind of thing that gets an
 * app deleted.
 */
export async function pushAvailability(): Promise<{
  available: boolean;
  configured: boolean;
  permission: string;
}> {
  const push = await getPush();
  if (!push) return { available: false, configured: false, permission: "unsupported" };
  try {
    const state = await push.status();
    const permission = state?.permission ?? "unknown";
    return {
      available: true,
      configured: state?.configured === true,
      // On API < 33 the OS grants implicitly and the plugin reports "granted".
      permission,
    };
  } catch {
    return { available: false, configured: false, permission: "unknown" };
  }
}

/**
 * Registers this device for pushes against the signed-in athlete.
 *
 * Only ever call this after an athlete has actually turned something on. The
 * permission prompt is the OS's, and it is the one permission prompt an app
 * gets exactly one chance at: asking on first launch, before the athlete has
 * been told what any of it is for, is how you get a permanent "no".
 */
export async function registerPush(): Promise<PushOutcome> {
  const push = await getPush();
  if (!push) return { status: "unsupported" };

  let result: Awaited<ReturnType<PushPlugin["register"]>>;
  try {
    result = await push.register({ resolveWithToken: true });
  } catch (error) {
    return { status: "failed", error };
  }

  if (!result?.configured) return { status: "unconfigured" };
  if (result.permission !== "granted") return { status: "denied" };
  const token = result.token;
  if (!token || typeof token !== "string" || token.length < 8) {
    // No Play Services, or FCM throttled us. Not the athlete's problem and not
    // worth a dialog.
    return { status: "failed", error: new Error("no fcm token") };
  }

  const { error } = await supabase.rpc("claim_push_token", {
    p_token: token,
    p_platform: "android",
  });
  if (error) return { status: "failed", error };

  rememberToken(token);
  return { status: "registered", token };
}

/**
 * Removes this device's registration.
 *
 * Called on sign-out. A phone that keeps its token after the athlete signs out
 * keeps receiving the *next* account's notifications on a handset that may have
 * been handed to somebody else — the token is tied to the install, not to the
 * person.
 */
export async function unregisterPush(): Promise<void> {
  const token = readToken();
  if (token) {
    try {
      // The server row first: forgetting the token locally without removing the
      // row leaves a registration that can never be reached again, and FCM
      // reports such a send as successful, so nothing would ever look wrong.
      // Own-row RLS means this can only ever delete this athlete's row.
      await supabase.from("push_tokens").delete().eq("token", token);
    } catch {
      // Best effort: if the session has already gone this cannot succeed, and
      // the row is unreachable afterwards — which is why the local token is
      // still cleared below rather than being kept as a false reassurance.
    }
  }
  rememberToken(null);
  const push = await getPush();
  if (!push) return;
  try {
    await push.unregister();
  } catch {
    /* nothing to undo natively */
  }
}

