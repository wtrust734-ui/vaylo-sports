import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import AppSidebar from "./AppSidebar";
import BottomNav from "./BottomNav";
import VayloLoader from "@/components/VayloLoader";
import QuickCommandBar from "./QuickCommandBar";
import TabShell, { isTabRoot } from "./TabShell";
import BackBar from "./BackBar";
import { RefreshCw, LogOut } from "lucide-react";
import CookieNotice from "@/components/CookieNotice";
import { readFailed } from "@/lib/dbRead";
import { isGuestUser } from "@/lib/guestMode";
import {
  checkChallengeDeadlines,
  checkWorkoutReminder,
  markDailyCheckDone,
  shouldRunDailyCheck,
} from "@/lib/notificationTriggers";

const AppLayout = () => {
  const { session, profile, loading, profileError, guestError, signOut } = useAuth();
  const location = useLocation();

  // Once-per-day in-app notification check while the app is open. These are
  // inbox + realtime notifications, not lock-screen push — no push
  // infrastructure exists, and this keeps every notification traceable to
  // real logged data.
  useEffect(() => {
    if (!session?.user || !shouldRunDailyCheck()) return;
    let alive = true;
    const uid = session.user.id;
    (async () => {
      try {
        const [plansRes, joinedRes] = await Promise.all([
          supabase
            .from("training_plans")
            .select("id, title, week_current, duration_weeks, plan_data")
            .eq("user_id", uid)
            .eq("active", true)
            .limit(1)
            .maybeSingle(),
          supabase
            .from("challenge_participants")
            .select("challenge_id, progress, status")
            .eq("user_id", uid),
        ]);
        if (!alive) return;
        // Quiet: this is a once-a-day background check that retries on the next
        // app open, so a toast here would be noise. It is still REPORTED rather
        // than swallowed, which is the difference between a check that fails
        // silently forever and one that shows up in the console.
        if (readFailed(joinedRes.error, "your challenges", { quiet: true })) return;
        if (readFailed(plansRes.error, "your training plan", { quiet: true })) return;
        const joined = joinedRes.data ?? [];
        if (joined.length) {
          const ids = joined.map((p) => p.challenge_id);
          const { data: chs, error: chsError } = await supabase
            .from("challenges")
            .select("id, title, end_date, target_value")
            .in("id", ids);
          if (!alive) return;
          // Without titles and dates there is no deadline to check, and
          // `chs?.length` cannot tell a failed read from no challenges.
          if (!readFailed(chsError, "your challenges", { quiet: true }) && chs?.length) {
            await checkChallengeDeadlines(uid, chs, joined);
          }
        }
        await checkWorkoutReminder(uid, plansRes.data ?? null);
      } catch {
        // A failed check retries on the next app open; never break the layout.
      } finally {
        if (alive) markDailyCheckDone();
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
      <AppSidebar />
      {/* pb-28 clears the floating tab bar.

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
          so the two cannot collapse into one.

          The desktop offset is the sidebar's own width (`--vaylo-sidebar-w`),
          applied as `ps-` (padding-inline-start) so it follows the sidebar
          under RTL. It was `lg:pl-60` — 240px against a 272px aside — which
          left the sidebar's last 32px over the content on every desktop
          screen, and under RTL padded the left while the sidebar moved to the
          right, so it covered the content completely. */}
      <main className="relative pb-28 lg:ps-[var(--vaylo-sidebar-w)]">
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
      <CookieNotice />
    </div>
  );
};

export default AppLayout;
