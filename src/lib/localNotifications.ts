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
  /**
   * Which KIND of reminder this is — one shade id per kind (see
   * `notificationId`). Omitted means "general", which still gets its own slot so
   * it cannot collide with a reminder that names its kind.
   */
  kind?: string;
  /**
   * The item within the kind, when the kind speaks about more than one thing
   * (a specific challenge, say). A stable value here is what makes a repeat of
   * the same reminder UPDATE the copy on the shade instead of stacking a second
   * notification beside it. Never include a date: the date belongs to the dedup
   * key that decides whether to speak at all.
   */
  itemKey?: string;
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

/**
 * One id range per KIND of notification, and the item inside it.
 *
 * The id used to be derived from the current millisecond
 * (`Math.abs(Date.parse(new Date().toISOString())) % 10_000`), which was wrong in
 * both directions: two notifications shown in the same millisecond took the same
 * id, so the second silently replaced the first, and the same logical reminder
 * never reused an id anyway, so it could never update itself — the shade filled
 * with copies of a streak warning that had already been acted on.
 *
 * The layout is structural rather than a hash over the whole scheme: the kind
 * picks a range, so two different kinds can never land on the same id however
 * their items hash, and within a kind the id comes from the ITEM (never the
 * date, never the clock) so the same reminder updates in place.
 */
const KIND_RANGE = 100_000;
const KIND_SLOT: Record<string, number> = { streak: 0, workout: 1, challenge: 2, general: 3 };

/** djb2, bounded to one kind's range. Not a security boundary, just a spread. */
function hashToRange(value: string, range: number): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  return Math.abs(hash) % range;
}

/**
 * The shade id for one notification. Stable for the same kind and item; a
 * different kind cannot collide with it by construction. Exported for the test
 * that pins the two properties (no clock in the id, no cross-kind collision).
 */
export function notificationId(kind: string, itemKey: string): number {
  const slot = KIND_SLOT[kind] ?? KIND_SLOT.general;
  return BASE_ID + slot * KIND_RANGE + (itemKey ? hashToRange(itemKey, KIND_RANGE) : 0);
}

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
      // LOW (2), and it must match PushPlugin.kt, which creates this same id at
      // IMPORTANCE_LOW. Android freezes a channel's importance at its first
      // creation and silently ignores every later disagreement, so whichever of
      // the two runs first would decide whether a streak alert buzzes at 06:00 —
      // a coin toss, not a design. The channel is shared with push on purpose
      // (one switch for one idea), which is exactly why both sides have to say
      // the same thing.
      importance: 2,
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
          // Falls back to the title as the item, so two different general
          // notifications still differ from one another rather than one quietly
          // replacing the other.
          id: notificationId(
            notification.kind ?? "general",
            notification.itemKey ?? (notification.kind ? "" : notification.title),
          ),
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
