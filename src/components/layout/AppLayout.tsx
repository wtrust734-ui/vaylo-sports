import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import AppSidebar from "./AppSidebar";
import BottomNav from "./BottomNav";
import VayloLoader from "@/components/VayloLoader";
import { holdBootVeil, markBootReady } from "@/components/BootVeil";
import QuickCommandBar from "./QuickCommandBar";
import TabShell, { isTabRoot } from "./TabShell";
import BackBar from "./BackBar";
import { RefreshCw, LogOut } from "lucide-react";
import { isGuestUser } from "@/lib/guestMode";
import {
  checkChallengeDeadlines,
  checkLowBalance,
  checkMorningBriefing,
  checkPoorRecovery,
  checkReengagement,
  checkWorkoutReminder,
  markAppOpen,
  markDailyCheckDone,
  type TriggerPrefs,
  scheduleMorningReminders,
  scheduleReengagementPing,
  scheduleStreakReminder,
  shouldRunDailyCheck,
} from "@/lib/notificationTriggers";
import { getCurrentStreak } from "@/lib/recoveryStreak";

const AppLayout = () => {
  const { session, profile, loading, profileError, guestError, signOut } = useAuth();
  const location = useLocation();

  // Boot handoff: while this gate is up, the BootVeil stays up with it — the
  // veil is what the athlete sees during session restore, guest entry and the
  // profile fetch, so the app never crossfades into a spinner. The moment the
  // layout has something real to render, release it and let the fade reveal a
  // finished screen. Without this signal the veil would have to guess with a
  // timer, and a slow network would turn the guess into a visible second cut.
  useEffect(() => {
    if (loading) holdBootVeil();
    else markBootReady();
  }, [loading]);

  // Notification checks while the app is open (inbox + device shade through
  // the OS scheduler — no push infrastructure needed).
  //
  // Timing split on purpose: the morning briefing runs on opens before noon,
  // the evening nudge on opens after 17:00. The old shape ran everything
  // behind one once-per-day gate and marked it done in the morning, which
  // meant the evening nudge could never fire on a day the app had already
  // been opened. Each trigger still dedups itself (once per day per kind),
  // so running on every app open is safe.
  useEffect(() => {
    if (!session?.user) return;
    let alive = true;
    const uid = session.user.id;
    const { daysAway } = markAppOpen();
    (async () => {
      try {
        const [plansRes, joinedRes, prefsRes, profileRes] = await Promise.all([
          supabase
            .from("training_plans")
            .select("id, title, sport, week_current, duration_weeks, plan_data")
            .eq("user_id", uid)
            .eq("active", true)
            .limit(1)
            .maybeSingle(),
          supabase
            .from("challenge_participants")
            .select("challenge_id, progress, status")
            .eq("user_id", uid),
          supabase
            .from("notification_prefs")
            .select("*")
            .eq("user_id", uid)
            .maybeSingle(),
          // One small row for the low-credit warning: the balance and the
          // unlimited flag. Skipped silently when unreadable.
          supabase
            .from("profiles")
            .select("credits, infinite_credits")
            .eq("user_id", uid)
            .maybeSingle(),
        ]);
        if (!alive) return;
        if (joinedRes.error || plansRes.error) return;
        const plan = plansRes.data ?? null;
        const prefs = (prefsRes.data as unknown as TriggerPrefs | null) ?? {};
        const hour = new Date().getHours();
        // Pre-scheduled device timers (mornings 07:10 x7, reengagement +72h)
        // are refreshed on a once-per-day gate — rescheduling rewrites the
        // same stable ids, so the gate is thrift, not correctness.
        const refreshTimers = shouldRunDailyCheck();
        await checkReengagement(uid, daysAway);
        if (!alive) return;
        if (hour < 12) await checkMorningBriefing(uid, plan);
        if (!alive) return;
        if (hour >= 17) await checkWorkoutReminder(uid, plan);
        if (!alive) return;
        // Low credits (≤ 15, at most every 3 days) and poor recovery
        // (today's readiness ≤ 35, once a day). Both write the inbox always
        // and compete for the same 2-pings-a-day shade budget as everything
        // else, so a bad-recovery day with an empty wallet is still at most
        // two banners, never a barrage.
        const prof = (profileRes.data as { credits?: unknown; infinite_credits?: unknown } | null) ?? null;
        const balance = typeof prof?.credits === "number" ? prof.credits : null;
        await checkLowBalance(uid, balance, prof?.infinite_credits === true);
        if (!alive) return;
        await checkPoorRecovery(uid);
        if (!alive) return;
        const joined = joinedRes.data ?? [];
        if (joined.length) {
          const ids = joined.map((p) => p.challenge_id);
          const { data: chs } = await supabase
            .from("challenges")
            .select("id, title, end_date, target_value")
            .in("id", ids);
          if (!alive) return;
          if (chs?.length) await checkChallengeDeadlines(uid, chs, joined);
        }
        if (!alive) return;
        if (refreshTimers) {
          await scheduleMorningReminders(plan, prefs);
          await scheduleReengagementPing(uid, daysAway);
          markDailyCheckDone();
        } else {
          // Reengagement re-arms cheaply (one timer) on every open so the
          // 72h window always counts from the latest visit.
          await scheduleReengagementPing(uid, daysAway);
        }
        // The morning streak reminder arms on EVERY open, in both branches:
        // it is the one notification aimed at someone who has NOT opened the
        // app (the person whose streak is about to break), so it cannot depend
        // on the once-a-day refresh path above. Pre-scheduled for 08:00 so the
        // OS fires it with the app closed; the streak it quotes comes from the
        // anonymous recovery ledger on this device.
        const recoveryStreak = getCurrentStreak();
        await scheduleStreakReminder(
          recoveryStreak.current,
          recoveryStreak.checkInToday,
          prefs,
        ).catch(() => {});
      } catch {
        // A failed check retries on the next app open; never break the layout.
      }
    })();
    return () => {
      alive = false;
    };
  }, [session?.user]);

  if (loading) return <VayloLoader message="Checking your athlete profile" />;

  // Guest entry failed on the web: GoTrue refused signInAnonymously (the
  // Anonymous provider is off in the dashboard) or the network is down. There is
  // no session and none is coming, so the sign-in page is the only route out.
  //
  // Redirecting rather than showing a retry screen is deliberate. A retry button
  // that cannot succeed is a dead end dressed as a fix, and the sign-in page is
  // genuinely usable here: email and password needs no redirect URI, so it works
  // on a preview host where OAuth does not. The visitor loses nothing by signing
  // in instead of being a guest.
  if (guestError && !session) return <Navigate to="/auth" replace />;

  if (!session) return <Navigate to="/auth" replace />;
  // The onboarding wizard is skipped for a guest.
  //
  // It collects sport, experience, goal, training days and date of birth — a
  // setup step, and the preview has to open on the app itself with no setup in
  // front of it. A guest is an anonymous browser session with no identity yet;
  // asking it to fill in a seven-question form before it may look at the app is
  // exactly the wall the preview exists to avoid.
  //
  // Nothing is lost by skipping: the same gate still applies once the athlete
  // signs in for real (linkGuestIdentity in nativeOAuth.ts keeps the same user
  // id), so a real account is still walked through setup. And the age-dependent
  // protections do not depend on this — they read date_of_birth, which is
  // absent either way, and an absent date of birth is the refusing case.
  if (
    profile &&
    !profile.onboarding_complete &&
    !isGuestUser(session?.user)
  ) {
    return <Navigate to="/onboarding" replace />;
  }

  // The session is real but the profile row is unreadable — a network error,
  // a server outage or an RLS race. Rendering the app here would show every
  // screen as empty ("signed in with no data"), which reads as data loss.
  // Offer retry and a way out instead.
  if (!profile && profileError) {
    return (
      <div className="min-h-screen app-mesh bg-background flex flex-col items-center justify-center px-5 text-center">
        <h1 className="text-xl font-display font-bold">Couldn't load your athlete profile</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm">
          Check your connection and try again. Your training data is safe on the server.
        </p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-semibold"
          >
            <RefreshCw size={14} aria-hidden /> Try again
          </button>
          <button
            onClick={() => void signOut()}
            className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground"
          >
            <LogOut size={14} aria-hidden /> Sign out
          </button>
        </div>
      </div>
    );
  }

  // Tab roots are hosted by TabShell, which keeps all four alive; everything
  // else is an ordinary route. The Outlet is NOT rendered for a tab root —
  // otherwise the tab's page would render twice, once from the route table and
  // once from the keep-alive host.
  const onTabRoot = isTabRoot(location.pathname);

  return (
    <div className="min-h-screen app-mesh bg-background text-foreground antialiased">
      {/* Subtle top hairline + mesh stays fixed via body, but this adds a soft vignette on large screens */}
      <div aria-hidden className="pointer-events-none fixed inset-0 hidden lg:block" style={{ background: "radial-gradient(900px 500px at 50% -10%, hsla(217 100% 60% / 0.06), transparent 70%)" }} />
      <AppSidebar />          {/* pb-36 clears the floating tab bar (below).

          The top inset is NOT applied here. It lives on `body` in index.css,
          which is the only place it belongs: /auth and /onboarding render
          outside this layout, so a `pt-safe-t` here left the first two screens
          an athlete ever sees sitting under the status bar, while every screen
          that did have it risked double padding once the root rule existed.

          With the header gone, `--vaylo-screen-top` (12px, at every width) is
          now the only thing between the status bar and the first line of every
          screen. It is a token rather than a `pt-5` literal so a screen's top
          gutter cannot drift from screen to screen.

          A detail screen ends up with the gutter twice, on purpose: BackBar
          takes the first one directly under the status bar, and the page's own
          root takes the second, which is what separates the page's first
          element from the Back button above it. Neither carries a bottom pad,
          so the two cannot collapse into one. */}
      {/* The left reservation is the sidebar's own token, not a `pl-60`
          literal: 240px did not match the 272px aside, so the translucent
          panel sat over the first 32px of every page at `lg:` and up. */}
      {/* 112px of scroll headroom is UNDER the bar's real footprint: the bar
          itself ends ~90px above the floor (64px tab floor + 6px top pad +
          ~8px on the surface), but anything scrollable that stops there sits
          flush against its translucent edge, and fixed bottom overlays — the
          quick-action sheet scrim, the cookie notice — cover the last ~230px
          of the page at full scroll. The old 112px is now 144px (pb-36),
          which leaves exactly one full tab-band + one notice band above the
          floor: the last card on any tab is never entombed behind the bar or
          a bottom notice on first scroll end. Fixed overlays still overlap
          while scrolling (that is what fixed means); what this buys back is
          the bottom-of-page state, which is where users actually look. */}
      <main className="relative pb-36 lg:pb-28 lg:pl-[var(--vaylo-sidebar-w)]">
        {/* `min-w-0` on the flex/grid child is what actually stops a wide
            descendant (a long username, an AI response, a stat grid) from
            pushing the page wider than the viewport. Without it the child is
            sized by its content and `max-w` alone does not constrain it. */}
        <div className="mx-auto w-full min-w-0 max-w-[1100px]">
          {/* TabShell is ALWAYS mounted, never swapped out for the Outlet.

              An earlier draft rendered it only on a tab root, which quietly
              broke the whole point of it: tapping Train takes the athlete to a
              detail screen (/workouts), that swapped component unmounted the
              four panels, and every query, scroll offset and half-filled form
              was destroyed on the way back. Hiding the host instead of
              unmounting it is what makes "come back to the tab and it is still
              there" true for detail screens, not just for tab-to-tab taps.

              `hidden` on this wrapper is the right primitive: it removes the
              panels from the accessibility tree and the tab order as well as
              from layout, which `opacity: 0` would not. */}
          <div hidden={!onTabRoot} aria-hidden={!onTabRoot ? true : undefined}>
            {/* Keyed by user id: signing out and back in as somebody else must
                not inherit the previous athlete's still-mounted panels. */}
            <TabShell key={session.user.id} />
          </div>

          {!onTabRoot && (
            /* Keyed by pathname so the fade re-runs per navigation. This
               replaces a framer-motion exit animation, which held the arriving
               screen back until the leaving one had finished animating
               (`mode="wait"`) — the single biggest contributor to navigation
               feeling slow. There is no exit animation now: the old screen is
               gone in the same frame, and only the new one fades in.

               `nav-enter` (index.css) rather than the tabs' `nav-fade`: same
               240ms ease-out curve, but it starts at 0.4 opacity instead of 0,
               so the frame after the swap already shows legible content rather
               than bare background — the blink this produced on every drill-in
               and back was the rough edge felt worst on the APK's WebView.
               Tabs keep the full 0→1 crossfade because they phase theirs over
               an outgoing fade first. */
            <div key={location.pathname} className="nav-enter">
              {/* Outside the screen, not inside it: a back control has to be
                  present on every detail screen including ones added later,
                  and a screen that drew its own would otherwise show two.
                  It renders above the page so it never competes with a hero. */}
              <BackBar />
              <Outlet />
            </div>
          )}
        </div>
      </main>
      <QuickCommandBar />
      <BottomNav />
    </div>
  );
};

export default AppLayout;
