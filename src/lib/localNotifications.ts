// ============================================================================
// DEVICE NOTIFICATIONS WITHOUT A SERVER
// ----------------------------------------------------------------------------
// The triggers in notificationTriggers.ts already decide what is worth saying:
// a streak about to break, today's plan session still unlogged, a challenge
// closing in three days. Until now that only ever reached the in-app inbox —
// a message for someone who is already looking at the app.
//
// This presents the same message on the device's own notification shade, which
// survives the app being backgrounded or closed and is the thing an athlete
// actually notices. It uses the OS's local notification scheduler, so there is
// no Firebase project, no credential, no network and no server involved.
//
// WHAT THIS IS NOT
//
// It is not a replacement for lib/push.ts. Nothing here can arrive while the
// app is closed and no trigger has run: a local notification needs code on the
// device to decide to show it. Server-sent push still requires the Firebase
// project described in android/app/src/main/res/values/vaylo_fcm.xml, and that
// remains the honest limitation rather than something to paper over.
//
// QUIET HOURS
//
// The athlete's quiet hours (notification_prefs) are applied by the caller
// before anything is shown, because the prefs are read there anyway. Nothing in
// this module decides when it is polite to speak.
// ============================================================================

import { isNative, loadPlugin } from "@/lib/platform";

/** Where the notification should land on tap. */
export interface DeviceNotification {
  title: string;
  body: string;
  /** In-app route, or null for "just open the app". */
  link?: string | null;
}

export type DeviceNotifyOutcome =
  | "shown"
  | "denied"
  | "unsupported"
  | "failed"
  /** The athlete has switched device notifications off in prefs. */
  | "muted";

interface LocalNotificationsPlugin {
  checkPermissions: () => Promise<{ display?: string }>;
  requestPermissions: () => Promise<{ display?: string }>;
  createChannel: (channel: {
    id: string;
    name: string;
    description?: string;
    importance?: number;
    visibility?: number;
  }) => Promise<void>;
  schedule: (options: {
    notifications: {
      id: number;
      title: string;
      body: string;
      channelId?: string;
      extra?: Record<string, unknown>;
    }[];
  }) => Promise<unknown>;
  addListener: (
    eventName: "localNotificationActionPerformed",
    listener: (event: { notification?: { extra?: Record<string, unknown> } }) => void,
  ) => Promise<{ remove: () => Promise<void> }>;
}

/**
 * Must match PushChannels.kt. A channel id cannot be renamed after creation, so
 * device notifications and push land in the same "Training reminders" channel
 * rather than giving the athlete two switches for one idea.
 */
export const LOCAL_CHANNEL_REMINDERS = "vaylo_reminders";

/** Notification ids must be stable 32-bit ints; this is the "vaylo" namespace. */
const BASE_ID = 8_100_000;

let permissionAsked = false;
let channelReady = false;

const plugin = async (): Promise<LocalNotificationsPlugin | null> =>
  (await loadPlugin<LocalNotificationsPlugin>("local-notifications")) ?? null;

/**
 * Whether this build can show a device notification at all. False in a browser:
 * the Web Notification API needs a visible tab and its own permission, which is
 * a different promise than "this will reach your phone".
 */
export const deviceNotificationsSupported = (): boolean => isNative();

/**
 * Ask once per app run. A refusal is respected and never re-asked in the same
 * session: re-prompting is nagging, and the athlete can change it in Android's
 * own settings at any time.
 */
async function ensurePermission(p: LocalNotificationsPlugin): Promise<boolean> {
  const current = await p.checkPermissions().catch(() => null);
  if (current?.display === "granted") return true;
  if (permissionAsked) return false;
  permissionAsked = true;
  const asked = await p.requestPermissions().catch(() => null);
  return asked?.display === "granted";
}

async function ensureChannel(p: LocalNotificationsPlugin): Promise<void> {
  if (channelReady) return;
  await p
    .createChannel({
      id: LOCAL_CHANNEL_REMINDERS,
      name: "Training reminders",
      description: "Training plan nudges, streak warnings and challenge deadlines.",
      importance: 3,
      visibility: 0,
    })
    .catch(() => {
      // Channel creation fails on old API levels, where the concept does not
      // exist. The notification still posts, so this is not worth failing on.
    });
  channelReady = true;
}

/**
 * Show one notification now. Never throws: a notification is a nicety, and a
 * failure here must not disturb the flow that produced it.
 */
export async function showDeviceNotification(
  notification: DeviceNotification,
): Promise<DeviceNotifyOutcome> {
  if (!deviceNotificationsSupported()) return "unsupported";
  const p = await plugin();
  if (!p) return "unsupported";
  try {
    if (!(await ensurePermission(p))) return "denied";
    await ensureChannel(p);
    await p.schedule({
      notifications: [
        {
          id: BASE_ID + (Math.abs(Date.parse(new Date().toISOString())) % 10_000),
          title: notification.title,
          body: notification.body,
          channelId: LOCAL_CHANNEL_REMINDERS,
          extra: { link: notification.link ?? null },
        },
      ],
    });
    return "shown";
  } catch {
    return "failed";
  }
}

/**
 * Routes a tap on a device notification back into the app.
 *
 * Only alongside the app's own router, so the destination goes through
 * safeNotificationLink (an in-app route) rather than being trusted here — the
 * value round-trips through the OS and comes back as untrusted input.
 */
export function installNotificationTapHandler(
  onOpen: (link: string | null) => void,
): () => void {
  let removed = false;
  let handle: { remove: () => Promise<void> } | null = null;
  void (async () => {
    const p = await plugin();
    if (!p || !deviceNotificationsSupported()) return;
    try {
      handle = await p.addListener("localNotificationActionPerformed", (event) => {
        const raw = event?.notification?.extra?.link;
        onOpen(typeof raw === "string" && raw ? raw : null);
      });
    } catch {
      // No listener support: taps simply open the app.
    }
  })();
  return () => {
    removed = true;
    void handle?.remove().catch(() => {});
    void removed;
  };
}
