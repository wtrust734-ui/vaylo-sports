import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { motion } from "framer-motion";
import { Bell, BellOff, CheckCircle2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { pushAvailability, registerPush } from "@/lib/push";
import { deviceNotificationsEnabled, deviceNotificationsSupported, enableDeviceNotifications } from "@/lib/localNotifications";
import { scheduleMorningReminders, scheduleReengagementPing, scheduleStreakReminder, type PlanLike, type TriggerPrefs } from "@/lib/notificationTriggers";
import { getCurrentStreak } from "@/lib/recoveryStreak";

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
  { key: "recovery_alerts", label: "Recovery warnings", desc: "A gentle note when today's readiness is very low, plus the morning reminder that keeps your streak alive." },
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

  // Permission already granted is the durable "notifications are on" fact. It
  // lives in the OS, not in this component, so reopening settings must read it
  // rather than defaulting to "off" and asking the athlete to turn it on again.
  useEffect(() => {
    let cancelled = false;
    void deviceNotificationsEnabled().then((enabled) => {
      if (!cancelled) setLocalOn(enabled);
    });
    return () => { cancelled = true; };
  }, []);

  /**
   * Apply the settings that own OS-scheduled notifications immediately.
   *
   * The database row is the source of truth for every trigger, but the morning
   * briefings and the next streak reminder are timers already handed to the OS.
   * Saving a switch without rewriting those timers would leave yesterday's
   * schedule running under today's setting — the athlete changes a toggle and
   * nothing changes until the next app open. This is the "genuinely applies"
   * half of the screen.
   */
  const applyDeviceSchedule = async (nextPrefs: TriggerPrefs) => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from("training_plans")
        .select("id, title, sport, week_current, duration_weeks, plan_data")
        .eq("user_id", user.id)
        .eq("active", true)
        .limit(1)
        .maybeSingle();
      const plan = (data as PlanLike) ?? null;
      await scheduleMorningReminders(plan, nextPrefs, new Date(), true);
      const streak = getCurrentStreak();
      await scheduleStreakReminder(streak.current, streak.checkInToday, nextPrefs);
      await scheduleReengagementPing(user.id, null);
    } catch {
      // The preferences are already saved; the next app open retries the timers.
    }
  };

  const quietPrefs = (next: { start: string; end: string }): Pick<TriggerPrefs, "quiet_start" | "quiet_end"> => ({
    quiet_start: next.start ? `${next.start}:00` : null,
    quiet_end: next.end ? `${next.end}:00` : null,
  });

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
    const previous = prefs;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    const { error } = await supabase.from("notification_prefs").upsert({ user_id: user.id, ...next }, { onConflict: "user_id" });
    if (error) {
      // Put the switch back where it was: leaving it on a value the server did
      // not save is the exact "it says on but nothing changed" failure.
      setPrefs(previous);
      toast.error(error.message);
      return;
    }
    toast.success("Saved");
    await applyDeviceSchedule({ ...next, ...quietPrefs(quiet) });
  };

  const saveQuiet = async (next: { start: string; end: string }) => {
    if (!user) return;
    const previous = quiet;
    setQuiet(next);
    // One missing end is not a no-op: an open-ended window is not a window, so
    // it clears the stored quiet hours instead of leaving the old values running
    // under an empty-looking form.
    const clearing = !next.start || !next.end;
    const quietValues = clearing
      ? { quiet_start: null, quiet_end: null }
      : quietPrefs(next);
    const { error } = await supabase.from("notification_prefs").upsert(
      { user_id: user.id, quiet_start: quietValues.quiet_start, quiet_end: quietValues.quiet_end },
      { onConflict: "user_id" },
    );
    if (error) {
      setQuiet(previous);
      toast.error(error.message);
      return;
    }
    toast.success(clearing ? "Quiet hours cleared" : "Quiet hours saved");
    await applyDeviceSchedule({ ...prefs, ...quietValues });
  };

  const clearQuiet = () => saveQuiet({ start: "", end: "" });

  return (
    <div className="px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-2xl mx-auto">
      <h1 className="text-2xl font-display font-bold flex items-center gap-2 mb-1"><Bell className="h-6 w-6 text-electric-purple" /> Notification settings</h1>
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
            {push.kind === "ready" && !localOn && (
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
                  onClick={clearQuiet}
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