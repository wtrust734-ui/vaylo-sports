import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { motion } from "framer-motion";
import { Bell, BellOff, CheckCircle2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { pushAvailability, registerPush } from "@/lib/push";
import { deviceNotificationsSupported, enableDeviceNotifications, showDeviceNotification } from "@/lib/localNotifications";

const KEYS: { key: string; label: string; desc: string }[] = [
  { key: "workout_reminders", label: "Workout reminders", desc: "Daily nudges to keep you on plan." },
  // Back, with the friends surface (2026-10-08, docs/FRIENDS.md). This switch
  // was retired in the morning because nothing in the app could add a friend,
  // so the stream it promised could not arrive. Now it can, and it is not a
  // decoration: `notify_direct_message()` reads this column and writes nothing
  // to the bell while it is off, as push-notify already did.
  { key: "friend_activity", label: "Friend activity", desc: "Messages from friends, and the activity they share with you." },
  { key: "streak_alerts", label: "Streak alerts", desc: "Warnings before your streak breaks." },
  { key: "challenge_deadlines", label: "Challenge deadlines", desc: "Reminders for joined challenges." },
  { key: "reengagement", label: "We miss you", desc: "Occasional re-engagement after inactivity." },
  // New with the 07:10 schedule release: a warning at ≤ 15 credits (at most
  // every 3 days — money talk fatigues fast), and a gentle note when today's
  // recovery check-in scores badly. Both need their columns (migration
  // 20261014120000); until it is applied the switches read on and toggling
  // one reports the error instead of pretending it saved.
  { key: "low_balance", label: "Low credit warnings", desc: "A heads-up when your credits run low. At most every 3 days." },
  { key: "recovery_alerts", label: "Recovery warnings", desc: "A gentle note when today's readiness is very low." },
];

/**
 * What this device can actually deliver, as opposed to what the switches say.
 *
 * These are different questions and the screen used to conflate them: the
 * toggles wrote to the database and looked like they controlled delivery, while
 * no device could receive anything at all. Telling the athlete the truth here
 * is the difference between a setting and a decoration.
 */
type PushState =
  | { kind: "checking" }
  | { kind: "ready" }
  | { kind: "registered" }
  | { kind: "unconfigured" }
  | { kind: "denied" }
  | { kind: "unsupported" };

export default function NotificationPrefs() {
  const { user } = useAuth();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [quiet, setQuiet] = useState<{ start: string; end: string }>({ start: "", end: "" });
  const [loading, setLoading] = useState(true);
  const [push, setPush] = useState<PushState>({ kind: "checking" });
  const [registering, setRegistering] = useState(false);
  /**
   * Device (local) reminders are on for this install.
   *
   * Separate from `push` on purpose: server-sent push needs a Firebase project
   * this build does not have, but the phone's own notification scheduler does
   * not — and until now there was no button anywhere that would ask for the OS
   * permission, so "you can get notifications from Vaylo Sports" was a promise
   * with no way to accept it (owner report, 2026-10-11).
   */
  const [localOn, setLocalOn] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("notification_prefs").select("*").eq("user_id", user.id).maybeSingle();
      setPrefs(data || KEYS.reduce((a, k) => ({ ...a, [k.key]: true }), {}));
      if (data?.quiet_start && data?.quiet_end) {
        // time columns come back as "HH:MM:SS"; <input type="time"> wants "HH:MM".
        setQuiet({ start: String(data.quiet_start).slice(0, 5), end: String(data.quiet_end).slice(0, 5) });
      }
      setLoading(false);
    })();
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const state = await pushAvailability();
      if (cancelled) return;
      if (!state.available) {
        setPush({ kind: "unsupported" });
      } else if (!state.configured) {
        setPush({ kind: "unconfigured" });
      } else if (state.permission !== "granted") {
        setPush({ kind: "denied" });
      } else {
        setPush({ kind: "ready" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Registration happens HERE, on an explicit tap, and nowhere else.
   *
   * The permission dialog is the one prompt an OS gives an app a single chance
   * at: an athlete who says no at first launch has usually said no for good.
   * Asking at the moment they are standing on the screen that says what the
   * notification will be is the only version of this that is not annoying.
   */
  const enablePush = async () => {
    setRegistering(true);
    try {
      const result = await registerPush();
      switch (result.status) {
        case "registered":
          setPush({ kind: "registered" });
          toast.success("This device will get notifications");
          break;
        case "denied":
          setPush({ kind: "denied" });
          toast.error("Notifications are blocked for Vaylo in your device settings.");
          break;
        case "unconfigured":
          setPush({ kind: "unconfigured" });
          toast.error("Push delivery is not set up in this build yet.");
          break;
        case "unsupported":
          setPush({ kind: "unsupported" });
          break;
        case "failed":
          toast.error("Could not turn on notifications. Try again later.");
          break;
      }
    } finally {
      setRegistering(false);
    }
  };

  /**
   * Turns on the OS notification permission and this app's reminder channel.
   *
   * Shown only where the device can do it (a real native app) and only for the
   * local-reminder path, so it can never imply that server-sent push is live
   * when the build has no delivery service behind it.
   */
  const enableLocal = async () => {
    setRegistering(true);
    try {
      const outcome = await enableDeviceNotifications();
      if (outcome === "shown") {
        setLocalOn(true);
        toast.success("Reminders are on for this device");
      } else if (outcome === "denied") {
        toast.error("Notifications are blocked for Vaylo in your device settings.");
      } else if (outcome !== "unsupported") {
        toast.error("Could not turn on reminders. Try again later.");
      }
    } finally {
      setRegistering(false);
    }
  };

  const toggle = async (key: string, value: boolean) => {
    if (!user) return;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    const { error } = await supabase.from("notification_prefs").upsert({ user_id: user.id, ...next }, { onConflict: "user_id" });
    if (error) toast.error(error.message); else toast.success("Saved");
  };

  const saveQuiet = async (next: { start: string; end: string }) => {
    if (!user) return;
    setQuiet(next);
    if (!next.start || !next.end) return;
    const { error } = await supabase.from("notification_prefs").upsert(
      { user_id: user.id, quiet_start: `${next.start}:00`, quiet_end: `${next.end}:00` },
      { onConflict: "user_id" },
    );
    if (error) toast.error(error.message); else toast.success("Quiet hours saved");
  };

  return (
    <div className="px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold flex items-center gap-2 mb-1"><Bell className="h-6 w-6 text-electric-purple" /> Notification settings</h1>
      <p className="text-sm text-muted-foreground mb-6">Choose what we ping you about. Smart send-times prevent late-night noise.</p>

      <div className="p-4 rounded-2xl border border-border bg-card mb-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">
            {localOn || push.kind === "registered" ? (
              <CheckCircle2 className="h-5 w-5 text-success" />
            ) : push.kind === "denied" || push.kind === "unsupported" ? (
              <BellOff className="h-5 w-5 text-muted-foreground" />
            ) : (
              <Smartphone className="h-5 w-5 text-electric-purple" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium">Notifications on this device</p>
            <div className="text-xs text-muted-foreground mt-0.5">
              {push.kind === "checking" && "Checking what this device can deliver…"}
              {localOn &&
                "Reminders are on for this device. The switches below decide what is posted, and they stay on the screen after you close the app."}
              {!localOn && push.kind === "registered" &&
                "This device is registered. Anything you switch on below can reach you when the app is closed."}
              {push.kind === "ready" &&
                "Your device allows notifications, but this phone is not registered yet. Nothing below can reach you until it is."}
              {push.kind === "denied" &&
                "Notifications are turned off for Vaylo in your device settings. Turn them on there, then come back."}
              {!localOn && push.kind === "unconfigured" &&
                deviceNotificationsSupported()
                  ? "Reminders reach this phone through its own notification system: when the app notices something worth telling you about — a session still unlogged, a streak about to break — it posts it here, and it stays on the screen after you close the app. Server-sent push (a message arriving while the app has not run) needs a delivery service this build does not have, so nothing arrives out of the blue. Turn them on below; the switches then decide what is posted."
                  : "This build has no push delivery configured. The switches below still control your in-app notifications."}
              {push.kind === "unsupported" &&
                "Push delivery is only available in the Vaylo app on Android. In a browser these switches still control your in-app notifications."}
            </div>
            {(push.kind === "ready") && (
              <button
                onClick={enablePush}
                disabled={registering}
                className="mt-3 text-sm font-semibold text-electric-purple underline disabled:opacity-50"
              >
                {registering ? "Turning on…" : "Turn on notifications on this device"}
              </button>
            )}
            {/* The path that actually exists in this build: the phone's own
                scheduler. Without this button the screen explained the limit and
                then offered the athlete nothing to do about it. */}
            {!localOn && push.kind === "unconfigured" && deviceNotificationsSupported() && (
              <button
                onClick={enableLocal}
                disabled={registering}
                className="mt-3 text-sm font-semibold text-electric-purple underline disabled:opacity-50"
              >
                {registering ? "Turning on…" : "Turn on reminders on this device"}
              </button>
            )}
            {localOn && (
              <p className="mt-2 text-xs font-semibold text-success">Reminders are on for this device.</p>
            )}
            {/* Immediate proof the shade path works, without waiting for 07:00.
                Posts the same way the morning briefing does (same channel,
                same permission), so a test that arrives means 07:10 arrives. */}
            {deviceNotificationsSupported() && (
              <button
                onClick={async () => {
                  setRegistering(true);
                  try {
                    const outcome = await showDeviceNotification({
                      title: "Test from Vaylo ✅",
                      body: "If you can read this, notifications reach this phone. The morning briefing arrives at 07:10.",
                      link: "/training",
                    });
                    if (outcome === "shown") toast.success("Test sent — check your notification shade");
                    else if (outcome === "denied") toast.error("Notifications are blocked for Vaylo in your device settings.");
                    else if (outcome !== "unsupported") toast.error("Could not send the test. Try again later.");
                  } finally {
                    setRegistering(false);
                  }
                }}
                disabled={registering}
                className="mt-3 text-sm font-semibold text-electric-purple underline disabled:opacity-50"
              >
                {registering ? "Sending…" : "Send a test notification now"}
              </button>
            )}
          </div>
        </div>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <div className="space-y-2">
          {KEYS.map((k, i) => (
            <motion.div
              key={k.key}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="flex items-start justify-between gap-4 p-4 rounded-2xl border border-border bg-card"
            >
              <div>
                <p className="font-medium">{k.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{k.desc}</p>
              </div>
              <Switch checked={!!prefs[k.key]} onCheckedChange={(v) => toggle(k.key, v)} />
            </motion.div>
          ))}

          <div className="p-4 rounded-2xl border border-border bg-card">
            <p className="font-medium">Quiet hours</p>
            <p className="text-xs text-muted-foreground mt-0.5 mb-3">
              No reminders during these times, in your device's own clock.
            </p>
            <div className="flex items-center gap-2">
              <input type="time" value={quiet.start} onChange={(e) => saveQuiet({ ...quiet, start: e.target.value })}
                aria-label="Quiet hours start"
                className="bg-muted border border-border rounded-lg px-3 py-2 text-sm" />
              <span className="text-sm text-muted-foreground">to</span>
              <input type="time" value={quiet.end} onChange={(e) => saveQuiet({ ...quiet, end: e.target.value })}
                aria-label="Quiet hours end"
                className="bg-muted border border-border rounded-lg px-3 py-2 text-sm" />
              {quiet.start && quiet.end && (
                <button
                  onClick={() => { setQuiet({ start: "", end: "" }); if (user) void supabase.from("notification_prefs").upsert({ user_id: user.id, quiet_start: null, quiet_end: null }, { onConflict: "user_id" }); }}
                  className="ml-auto text-xs text-muted-foreground underline"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}