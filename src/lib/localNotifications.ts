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
    sound?: string;
    vibration?: boolean;
  }) => Promise<void>;
  deleteChannel?: (args: { id: string }) => Promise<void>;
  schedule: (options: {
    notifications: {
      id: number;
      title: string;
      body: string;
      channelId?: string;
      /**
       * Explicit time to post. Passing it always (rather than omitting it) is
       * what makes the OS post the notification on both Android and iOS; the
       * plugin's "no schedule" path is not documented as an immediate show.
       */
      schedule?: { at: Date; allowWhileIdle?: boolean; repeats?: boolean };
      extra?: Record<string, unknown>;
    }[];
  }) => Promise<unknown>;
  getPending: () => Promise<{ notifications: { id: string | number }[] }>;
  cancel: (options: { notifications: { id: number }[] }) => Promise<void>;
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

/**
 * Stable ids for scheduled (future) notifications, so re-scheduling the same
 * day overwrites rather than duplicates.
 *
 * Morning briefings live in 8_110_000 + MMDD (e.g. Oct 14 -> 8_111_014): one
 * slot per calendar day, unique within a year, stable across re-schedules.
 * The reengagement ping owns a single id: each app open cancels and re-arms
 * it 72h out, so there is never more than one.
 */
export const REENGAGEMENT_NOTIFICATION_ID = 8_120_000;

export function morningIdForDate(date: Date): number {
  const mmdd = (date.getMonth() + 1) * 100 + date.getDate();
  return 8_110_000 + mmdd;
}

/** How far ahead the OS is asked to post. Short enough to feel immediate. */
const POST_DELAY_MS = 1_000;

let permissionAsked = false;
let channelReady = false;

/**
 * Channel generation. Bumped to 2 when the channel moved from DEFAULT to
 * HIGH importance (the heads-up fix, 2026-10-14): Android ignores importance
 * changes on an existing channel, so the old one must be deleted and
 * recreated — otherwise every phone that installed before the fix keeps the
 * silent channel for ever.
 *
 * Bumped to 3 with the icon fix: a fresh delete-and-recreate also clears any
 * per-channel choice the athlete made while the channel was silent (e.g. a
 * long-press "Silent" from the weeks it never popped), which an in-place
 * channel would keep honouring for ever.
 */
const CHANNEL_VERSION = 3;
const CHANNEL_VERSION_KEY = "vaylo_channel_v1";

function storedChannelVersion(): number {
  try {
    return Number(localStorage.getItem(CHANNEL_VERSION_KEY)) || 0;
  } catch {
    return 0;
  }
}

function markChannelVersion(): void {
  try {
    localStorage.setItem(CHANNEL_VERSION_KEY, String(CHANNEL_VERSION));
  } catch { /* private mode — migration re-runs, harmlessly */ }
}

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
  // HIGH importance (4) is what makes the notification peek from the top of
  // the screen with sound instead of landing silently in the shade — the
  // owner report of 2026-10-14 was exactly this: DND off, notification
  // arrived, but nothing popped. visibility 1 shows the full text on the
  // lock screen rather than a redacted "contents hidden".
  const channel = {
    id: LOCAL_CHANNEL_REMINDERS,
    name: "Training reminders",
    description: "Training plan nudges, streak warnings and challenge deadlines.",
    importance: 4,
    visibility: 1,
    vibration: true,
  };
  try {
    if (storedChannelVersion() < CHANNEL_VERSION && p.deleteChannel) {
      // The pre-fix install already owns this channel id at DEFAULT
      // importance, and Android keeps the old importance no matter what
      // createChannel says now. Delete-then-recreate is the only upgrade
      // path that does not orphan the athlete's per-channel setting under a
      // new id.
      await p.deleteChannel({ id: LOCAL_CHANNEL_REMINDERS }).catch(() => {});
    }
    await p.createChannel(channel);
    markChannelVersion();
  } catch {
    // Channel creation fails on old API levels, where the concept does not
    // exist. The notification still posts, so this is not worth failing on.
  }
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
          id: BASE_ID + (Date.now() % 10_000),
          title: notification.title,
          body: notification.body,
          channelId: LOCAL_CHANNEL_REMINDERS,
          schedule: { at: new Date(Date.now() + POST_DELAY_MS) },
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
 * Schedule one notification for a future moment. The OS owns the timer from
 * here: it fires with the app backgrounded or closed, which is the whole
 * point — the morning briefing cannot depend on the app being open at 07:10.
 *
 * Same id twice overwrites (stable ids per day), never throws, and respects
 * the same once-per-session permission discipline as the immediate path.
 */
export async function scheduleDeviceNotificationAt(
  notification: DeviceNotification & { at: Date; id: number },
): Promise<DeviceNotifyOutcome> {
  if (!deviceNotificationsSupported()) return "unsupported";
  if (notification.at.getTime() <= Date.now()) return "failed";
  const p = await plugin();
  if (!p) return "unsupported";
  try {
    if (!(await ensurePermission(p))) return "denied";
    await ensureChannel(p);
    await p.schedule({
      notifications: [
        {
          id: notification.id,
          title: notification.title,
          body: notification.body,
          channelId: LOCAL_CHANNEL_REMINDERS,
          schedule: { at: notification.at, allowWhileIdle: true },
          extra: { link: notification.link ?? null },
        },
      ],
    });
    return "shown";
  } catch {
    return "failed";
  }
}

/** Ids of notifications currently scheduled on the device (pending). */
export async function pendingDeviceNotificationIds(): Promise<Set<number>> {
  try {
    if (!deviceNotificationsSupported()) return new Set();
    const p = await plugin();
    if (!p || !p.getPending) return new Set();
    const pending = await p.getPending().catch(() => null);
    const ids = pending?.notifications ?? [];
    return new Set(ids.map((n) => Number(n.id)).filter((n) => Number.isFinite(n)));
  } catch {
    return new Set();
  }
}

/** Cancel scheduled notifications by id. Never throws. */
export async function cancelDeviceNotifications(ids: number[]): Promise<void> {
  try {
    if (!deviceNotificationsSupported() || !ids.length) return;
    const p = await plugin();
    if (!p || !p.cancel) return;
    await p.cancel({ notifications: ids.map((id) => ({ id })) }).catch(() => {});
  } catch {
    // Cancelling is hygiene, never worth failing a flow over.
  }
}

/**
 * Turns device notifications on, from a settings screen.
 *
 * showDeviceNotification already asks lazily, at the moment a trigger has
 * something to say. That is the right default, but it left the settings screen
 * unable to answer the one question an athlete asks there — "how do I turn
 * these on?" — because the permission prompt only appeared later, in a flow the
 * athlete never connected to the switch. This is the explicit version: request
 * the permission and create the channel now, so the answer is a button rather
 * than a wait. Returns "shown" when the permission and channel are in place.
 */
export async function enableDeviceNotifications(): Promise<DeviceNotifyOutcome> {
  if (!deviceNotificationsSupported()) return "unsupported";
  const p = await plugin();
  if (!p) return "unsupported";
  try {
    if (!(await ensurePermission(p))) return "denied";
    await ensureChannel(p);
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
 *
 * The listener registration is async, so cleanup can run before it resolves.
 * In that case the listener is removed as soon as it lands rather than leaked.
 */
export function installNotificationTapHandler(
  onOpen: (link: string | null) => void,
): () => void {
  let disposed = false;
  let handle: { remove: () => Promise<void> } | null = null;
  void (async () => {
    const p = await plugin();
    if (!p || !deviceNotificationsSupported()) return;
    try {
      const registered = await p.addListener("localNotificationActionPerformed", (event) => {
        const raw = event?.notification?.extra?.link;
        onOpen(typeof raw === "string" && raw ? raw : null);
      });
      if (disposed) {
        void registered.remove().catch(() => {});
      } else {
        handle = registered;
      }
    } catch {
      // No listener support: taps simply open the app.
    }
  })();
  return () => {
    disposed = true;
    void handle?.remove().catch(() => {});
    handle = null;
  };
}
