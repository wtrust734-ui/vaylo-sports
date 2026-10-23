import { QueryClientProvider } from "@tanstack/react-query";
import PipelineDashboard from "@/components/pipeline/PipelineDashboard";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import {
  BrowserRouter,
  HashRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { isNativeShell, loadPlugin } from "@/lib/platform";
import { routerBasename } from "@/lib/routerBase";
import { guestEntryAvailable } from "@/lib/guestMode";
import { isFlagOn } from "@/config/featureFlags";
import { consumeBackPress } from "@/lib/backButton";
import { dismissKeyboard, installKeyboardFocusScroller } from "@/lib/keyboard";
import { installDeepLinkHandler } from "@/lib/deepLinks";
import { ScrollRestoration } from "@/lib/scrollRestoration";
import { installOfflineQueue } from "@/lib/offlineQueue";
// Single toast renderer: sonner. The shadcn <Toaster/> and the reducer behind it
// were removed — src/hooks/use-toast.ts now forwards to sonner.
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import AppLayout from "@/components/layout/AppLayout";
import ScreenFallback from "@/components/ScreenFallback";
import ErrorBoundary from "@/components/ErrorBoundary";
import CookieNotice from "@/components/CookieNotice";
import MilestoneCelebration from "@/components/MilestoneCelebration";
import PaywallModal from "@/components/PaywallModal";
import CreditTopUpSheet from "@/components/market/CreditTopUpSheet";
const Notifications = lazy(() => import("./pages/Notifications"));
const ReferralLeaderboard = lazy(() => import("./pages/ReferralLeaderboard"));
const ChallengeInvite = lazy(() => import("./pages/ChallengeInvite"));
const DiscordCommunity = lazy(() => import("./pages/DiscordCommunity"));
const NotificationPrefs = lazy(() => import("./pages/NotificationPrefs"));
const Referrals = lazy(() => import("./pages/Referrals"));
const CreatorMarketplace = lazy(() => import("./pages/CreatorMarketplace"));
const BecomeCreator = lazy(() => import("./pages/BecomeCreator"));
const CoachStudio = lazy(() => import("./pages/CoachStudio"));
const CoachSignup = lazy(() => import("./pages/CoachSignup"));
// The Ads Studio is a full-screen product surface with its own sidebar/nav
// shell — it must NOT render inside AppLayout. Lazy like every other route so
// its weight stays out of the athlete app's entry chunk.
const AdsStudio = lazy(() => import("./pages/studio/StudioApp"));

import OfflineBanner from "@/components/OfflineBanner";
import BootVeil, { bootVeilGated, markBootReady } from "@/components/BootVeil";
import TermsChangeNotice from "@/components/legal/TermsChangeNotice";

// Gate screens are lazy like every other route: a signed-in athlete never
// renders them, so their weight (~80 kB of source, tens of kB minified)
// belongs behind the router's Suspense (ScreenFallback), not in the entry
// chunk that every cold start pays for.
const Auth = lazy(() => import("./pages/Auth"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
import Index from "./pages/Index";
// The published legal documents, rendered inside the app rather than on the
// marketing site. Lazy: it bundles all 26 documents (~330 KB), so the chunk
// belongs to the reader who opens one, not to app start.
const LegalDocument = lazy(() => import("./pages/LegalDocument"));
const Training = lazy(() => import("./pages/Training"));
const Availability = lazy(() => import("./pages/Availability"));
const Nutrition = lazy(() => import("./pages/Nutrition"));
const Mental = lazy(() => import("./pages/Mental"));
const Coach = lazy(() => import("./pages/Coach"));
const Profile = lazy(() => import("./pages/Profile"));
const Recovery = lazy(() => import("./pages/Recovery"));
const Market = lazy(() => import("./pages/Market"));
const FormAnalysis = lazy(() => import("./pages/FormAnalysis"));
const VideoFormAnalysis = lazy(() => import("./pages/VideoFormAnalysis"));
const CrossSportAnalysis = lazy(() => import("./pages/CrossSportAnalysis"));
const Arcade = lazy(() => import("./pages/Arcade"));
const Events = lazy(() => import("./pages/Events"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Subscription = lazy(() => import("./pages/Subscription"));
const EventPacks = lazy(() => import("./pages/EventPacks"));
const Achievements = lazy(() => import("./pages/Achievements"));
const Badges = lazy(() => import("./pages/Badges"));
const VPR = lazy(() => import("./pages/VPR"));
const Train = lazy(() => import("./pages/Train"));
const Perform = lazy(() => import("./pages/Perform"));
const Recover = lazy(() => import("./pages/Recover"));
const Compete = lazy(() => import("./pages/Compete"));
const SkillAnalytics = lazy(() => import("./pages/SkillAnalytics"));
const Tactics = lazy(() => import("./pages/Tactics"));
const Development = lazy(() => import("./pages/Development"));
const Identity = lazy(() => import("./pages/Identity"));
const Injury = lazy(() => import("./pages/Injury"));


const Learning = lazy(() => import("./pages/Learning"));
const LearningArticle = lazy(() => import("./pages/LearningArticle"));
const MetricsHub = lazy(() => import("./pages/MetricsHub"));
const Compare = lazy(() => import("./pages/Compare"));
const Avatar = lazy(() => import("./pages/Avatar"));
const Goals = lazy(() => import("./pages/Goals"));
const Guardian = lazy(() => import("./pages/Guardian"));
const StartingAnalysis = lazy(() => import("./pages/StartingAnalysis"));
const Insights = lazy(() => import("./pages/Insights"));

const PublicProfile = lazy(() => import("./pages/PublicProfile"));
const PBs = lazy(() => import("./pages/PBs"));

// Log only: this screen records a session that has already happened. It
// cannot start or track one — the Android build declares no location
// permission, so a live workout would have no route and no distance.
const Workouts = lazy(() => import("./pages/Workouts"));
const AdminPricing = lazy(() => import("./pages/AdminPricing"));
const AdminRewards = lazy(() => import("./pages/AdminRewards"));
const AdminEventPacks = lazy(() => import("./pages/AdminEventPacks"));
const AdminWaitlist = lazy(() => import("./pages/AdminWaitlist"));
const AdminErrorReports = lazy(() => import("./pages/AdminErrorReports"));
const AdminRefunds = lazy(() => import("./pages/AdminRefunds"));
const PurchasesRefunds = lazy(() => import("./pages/PurchasesRefunds"));
const EventPackLanding = lazy(() => import("./pages/EventPackLanding"));
const Challenges = lazy(() => import("./pages/Challenges"));
const ChallengeDetail = lazy(() => import("./pages/ChallengeDetail"));
const Collection = lazy(() => import("./pages/Collection"));
const AIDev = lazy(() => import("./pages/AIDev"));
const DeleteAccount = lazy(() => import("./pages/DeleteAccount"));
// Friends, restored 2026-10-08 with something to do. The page deleted on
// 2026-10-08 was an empty surface (no seeded users, nothing to reach); this one
// carries the friend graph, direct messages and per-activity sharing, so it is
// a destination rather than a placeholder.
const Friends = lazy(() => import("./pages/Friends"));
const FriendChat = lazy(() => import("./pages/FriendChat"));
// Legal & Safety centre, and the safety information it links to. Both reachable
// without leaving the app, because a right nobody can find is not a right.
const Legal = lazy(() => import("./pages/Legal"));
const Safety = lazy(() => import("./pages/Safety"));

const NotFound = lazy(() => import("./pages/NotFound"));

// The client lives in its own module so sign-out can clear it (AuthContext
// imports it directly — importing App from there would be circular).
import { queryClient } from "@/lib/queryClient";
import RequireAdmin from "@/components/auth/RequireAdmin";
import { installNotificationTapHandler } from "@/lib/localNotifications";
import { safeNotificationLink } from "@/lib/notifications";

// Inside the Capacitor shell the app is served as a local bundle, where a deep
// link or a refresh on /training has no server to fall back to. Hash routing is
// the safe default there; the web build keeps clean URLs.
const Router = isNativeShell() ? HashRouter : BrowserRouter;

// Only the web build is ever mounted below the origin root (the marketing site
// serves it at /play/). A HashRouter inside Capacitor has no server path to
// strip, so passing a basename there would be meaningless rather than harmless.
const routerProps = isNativeShell() ? {} : { basename: routerBasename() };

/**
 * What /auth shows, which differs by platform and by whether guest entry worked.
 *
 * Inside the Capacitor shell this is always the real sign-in page: OAuth returns
 * through the app's own URL scheme there, so it genuinely works and guest mode
 * is not offered at all.
 *
 * On the web, once guest entry has produced a session there is nothing to sign
 * into, so the route sends the visitor on into the app. But that redirect is
 * only correct while guest entry actually works. GoTrue refuses
 * signInAnonymously whenever the Anonymous provider is disabled in the
 * dashboard, and if that happens while guestError is set the visitor is sent to
 * /auth — which, if this unconditionally redirected onward, would bounce them
 * straight back to the app with no session. AppLayout would then re-redirect
 * here and the visitor would loop between two screens with no way to sign in.
 *
 * So the fallback matters: with no session, /auth renders the real page, where
 * email and password works because it needs no redirect URI. That is what makes
 * deploying the web build safe before the dashboard toggle is flipped, and it is
 * why the web build can be shipped independently of that setting.
 *
 * A guest is redirected onward. This looks like it hides the sign-in page, and
 * that is deliberate: the preview has to open IN THE APP, not on a sign-in wall
 * — a visitor who lands on /auth because their session had not been created yet
 * must be sent to the app the moment it is. An exception here for guests parked
 * them on the sign-in screen for ever.
 *
 * The OAuth buttons remain on this page for anyone genuinely signed out (no
 * session) — the state that needs them — but nothing on the marketing site
 * links here any more: the website preview advertises no sign-in at all and
 * drops a visitor straight into the app, while the APK, where OAuth actually
 * works, keeps its own sign-in screen.
 */
const AuthGate = () => {
  const { session, guestError } = useAuth();
  if (!guestEntryAvailable()) return <Auth />;
  if (session && !guestError) return <Navigate to="/" replace />;
  return <Auth />;
};

/**
 * The same fade every in-app screen gets, for the screens that render OUTSIDE
 * AppLayout.
 *
 * These are the public and pre-session routes — sign-in, onboarding, a shared
 * challenge invite, the referral board, the Discord page, and the legal
 * documents. They cannot live inside AppLayout (several must render with no
 * session at all), so they were the one place a tap produced a hard cut: the
 * whole app was replaced in a single frame with nothing to soften it, which
 * reads as "the app jumped" rather than as navigation. This is the identical
 * `.nav-enter` animation the router path uses — same duration, same curve,
 * opacity only (a transform here would re-anchor every `position: fixed`
 * child inside these screens, which is why no wrapper in this app translates).
 *
 * Keyed by pathname so the fade re-runs on each navigation, exactly like the
 * keyed wrapper inside AppLayout.
 */
const BareScreen = ({ children }: { children: ReactNode }) => {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="nav-enter">
      {children}
    </div>
  );
};

/**
 * Android's back button, wired through the Capacitor App plugin.
 *
 * Priority: an open overlay claims the press → otherwise normal history back →
 * at a root screen, send the app to the background (what Android users expect)
 * instead of hard-exiting. No-ops on the web and while the plugin is absent.
 */
const NativeBackButton = () => {
  const navigate = useNavigate();
  useEffect(() => {
    // Keeps the focused field above the keyboard on every screen, including
    // the ones that render outside AppLayout (/auth, /onboarding) — which is
    // where a new athlete meets their first form and the first chance to notice
    // that the caret is under the keyboard.
    return installKeyboardFocusScroller();
  }, []);

  // Replays writes that were made with no signal. Installed here rather than
  // in the queue module so it is tied to the app's lifetime, not the bundle's.
  useEffect(() => installOfflineQueue(), []);

  useEffect(() => {
    // Status bar appearance is set from JS as well as from capacitor.config.ts,
    // on purpose. The config is read by StatusBarPlugin.load(), which is not
    // guaranteed to run before the first frame; this call is, because the app
    // cannot render without this component mounting.
    //
    // Polarity is the trap here and it was documented backwards in this repo:
    // @capacitor/status-bar names the *bar*, not the icons (StatusBar.java:51):
    //   "DARK"  -> isAppearanceLightStatusBars(false) -> WHITE icons
    //   "LIGHT" -> isAppearanceLightStatusBars(true)  -> DARK icons
    // A dark UI needs "DARK". Anything else makes Android paint a light scrim
    // behind the icons — the white band that sat above the app on every screen.
    if (!isNativeShell()) return;
    let cancelled = false;
    void (async () => {
      const StatusBar = await loadPlugin<{
        setStyle: (options: { style: string }) => Promise<void>;
        setOverlaysWebView: (options: { overlay: boolean }) => Promise<void>;
      }>("status-bar");
      if (cancelled || !StatusBar) return;
      try {
        await StatusBar.setOverlaysWebView({ overlay: true });
        await StatusBar.setStyle({ style: "DARK" });
      } catch {
        // Plugin missing on web; the native theme already carries the same
        // values as the fallback.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isNativeShell()) return;
    let cancelled = false;
    let remove: (() => void) | undefined;

    void (async () => {
      const App = await loadPlugin<{
        addListener: (
          event: "backButton",
          callback: (event: { canGoBack: boolean }) => void
        ) => Promise<{ remove: () => void }>;
        minimizeApp?: () => void;
        exitApp?: () => void;
      }>("app");
      if (!App?.addListener || cancelled) return;

      const subscription = await App.addListener("backButton", ({ canGoBack }) => {
        // Keyboard first, then overlays, then navigation.
        //
        // Android users expect back to close the keyboard before it does
        // anything else. Without this, dismissing the keyboard by pressing back
        // on a form inside a bottom sheet closed the *sheet* instead — losing
        // half-typed input, which is the worst possible outcome of a gesture
        // that should have been harmless.
        if (dismissKeyboard()) return;
        if (consumeBackPress()) return;
        if (canGoBack) {
          window.history.back();
          return;
        }
        if (App.minimizeApp) App.minimizeApp();
        else App.exitApp?.();
      });
      if (cancelled) subscription?.remove?.();
      else remove = () => subscription?.remove?.();
    })();

    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);

  /**
   * Global deep-link dispatcher (native shell only).
   *
   * installDeepLinkHandler covers warm links, cold-start launch intents and
   * re-taps; parseDeepLink validates every URL, so an unknown scheme, a
   * malformed id or a foreign path is dropped before navigation. Shared
   * links are navigation hints only: nothing here grants access — protected
   * screens still go through AppLayout's session gate and RLS stays the
   * authority on data. OAuth callbacks are skipped here: the one-shot
   * listener in nativeOAuth.ts owns them.
   */
  useEffect(() => {
    if (!isNativeShell()) return;
    let dispose: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      const remove = await installDeepLinkHandler((parsed) => {
        if (parsed.path) navigate(parsed.path);
      });
      if (cancelled) remove?.();
      else dispose = remove ?? null;
    })();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [navigate]);

  return null;
};

/**
 * Opens the destination of a device notification tapped while the app was
 * closed or in the background.
 *
 * The link makes a round trip through the operating system and comes back as
 * untrusted input, so it goes through the same safeNotificationLink() whitelist
 * the in-app inbox uses — only in-app routes are ever navigated to.
 */
const NotificationTapNavigator = () => {
  const navigate = useNavigate();
  useEffect(() => {
    return installNotificationTapHandler((link) => {
      const safe = safeNotificationLink(link);
      if (safe) navigate(safe);
    });
  }, [navigate]);
  return null;
};

/**
 * Touch-first pointer (the native shell, and touch browsers). Hover tooltips
 * are a desktop pattern: under a thumb there is no hover, and a tooltip that
 * fires on long-press sits on top of the button being pressed. A long delay
 * effectively disables hover tooltips on touch while leaving focus tooltips
 * (keyboard / screen reader) intact.
 */
const isTouchUI = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(pointer: coarse)").matches;

const App = () => {
  // Boot handoff: the veil painted by main.tsx stays up until a screen tells us
  // a real content frame exists underneath it. AppLayout does that when its
  // profile gate clears (it calls holdBootVeil while that gate is up, so this
  // cap stands down); screens that never mount AppLayout — sign-in, onboarding,
  // the legal reader — are released by this cap instead. Either way the veil
  // cannot crossfade into a spinner, and no route we have no signal for can sit
  // behind it.
  useEffect(() => {
    if (bootVeilGated()) return;
    const timer = window.setTimeout(() => markBootReady(), 1000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
  <ErrorBoundary>
    <MotionConfig reducedMotion="user">
    <QueryClientProvider client={queryClient}>
    <TooltipProvider delayDuration={isTouchUI() ? 1500 : 300}>
      <Sonner />
      {/* Smooth boot handoff: holds the brand mark a beat, then crossfades
          into the app instead of popping. Mounted outside the Router — it
          never navigates — and above everything while up. */}
      <BootVeil />
      <Router {...routerProps}>
        {/* Inside the Router: this component now uses useNavigate() for deep
            links, and react-router throws on router hooks rendered outside
            <Router>. The UI audit caught this as an unhandled invariant error
            on every route when it was mounted above. */}
        <NativeBackButton />
        {/* Local-notification taps: rendered inside <Router> for the same
            reason as NativeBackButton — it navigates. */}
        <NotificationTapNavigator />
        {/* New screens start at the top; back returns to where the athlete was.
            Mounted inside <Router> because it reads the location. */}
        <ScrollRestoration />
        <AuthProvider>
          <SubscriptionProvider>
            <OfflineBanner />
            {/* Mounted app-wide rather than inside AppLayout: a material change
                to the Terms has to reach the athlete wherever they are, and a
                notice mounted per-screen is one a future screen forgets. It
                renders nothing for a signed-out visitor or a profile that has
                already accepted the current version. */}
            <TermsChangeNotice />
            {/* App-wide cookie/storage notice — never blocks, versioned, and
                stored on-device so each origin remembers independently. */}
            <CookieNotice />
            {/* Inline skeleton, never the full-screen loader. This boundary is
                what used to show "Loading your next screen" over the whole
                app while a route chunk arrived — the interstitial that made
                ordinary navigation read as a restart. Tab roots are hosted by
                TabShell and only pay this cost on their first ever visit. */}
            <Suspense fallback={<ScreenFallback />}>

              <Routes>
              {/* The sign-in page is a web dead end: on .netlify.app (and every
                  other preview host) OAuth has no owned domain to redirect back
                  to, so authRedirectUrl() throws and every button on the page
                  is inert. AuthProvider signs web visitors in as guests instead,
                  which lands them here in the app.

                  The route stays registered and is reached through AuthGate
                  rather than deleted, because deleting it would 404 the path the
                  marketing site links to, and because it is the fallback that
                  keeps the preview reachable when guest entry is unavailable. */}
              <Route path="/auth" element={<BareScreen><AuthGate /></BareScreen>} />
              <Route path="/onboarding" element={<BareScreen><Onboarding /></BareScreen>} />
              {/* Published legal documents, inside the app. Top-level rather
                  than under AppLayout on purpose: the sign-up screen links to
                  Terms and Privacy before an account exists, and a session
                  gate here would bounce that reader back to the sign-in wall. */}
              <Route path="/legal/:slug" element={<BareScreen><LegalDocument /></BareScreen>} />
              {/* Public viral surfaces — must render without a session (they
                  carry the join / signup CTAs). Shared links reach them via the
                  link-preview function's redirect. */}
              <Route path="/c/:id" element={<BareScreen><ChallengeInvite /></BareScreen>} />
              <Route path="/referral-leaderboard" element={<BareScreen><ReferralLeaderboard /></BareScreen>} />
              <Route path="/discord" element={<BareScreen><DiscordCommunity /></BareScreen>} />
              {/* Ads Studio — standalone shell below; handles its own auth gate. */}
              <Route path="/ad-studio" element={<BareScreen><AdsStudio /></BareScreen>} />
              <Route element={<AppLayout />}>
                <Route path="/" element={<Index />} />
                {/* Information-architecture hubs: every tile navigates to an
                    existing page; these only group destinations. */}
                <Route path="/train" element={<Train />} />
                <Route path="/perform" element={<Perform />} />
                <Route path="/recover" element={<Recover />} />
                <Route path="/compete" element={<Compete />} />
                <Route path="/training" element={<Training />} />
                {/* Life events & availability. Sits beside the plan rather than
                    inside it: the athlete's availability is a fact about their
                    life, and it outlives any single plan. */}
                <Route path="/availability" element={<Availability />} />
                <Route path="/nutrition" element={<Nutrition />} />
                <Route path="/form" element={<FormAnalysis />} />
                <Route path="/form/video" element={<VideoFormAnalysis />} />
                <Route path="/mental" element={<Mental />} />
                <Route path="/coach" element={<Coach />} />
                <Route path="/arcade" element={<Arcade />} />
                <Route path="/events" element={<Events />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/profile/:username" element={<PublicProfile />} />
                <Route path="/recovery" element={<Recovery />} />
                <Route path="/market" element={<Market />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/subscription" element={<Subscription />} />
                <Route path="/event-packs" element={<EventPacks />} />
                <Route path="/packs/:packId" element={<EventPackLanding />} />
                <Route path="/achievements" element={<Achievements />} />
                {/* The Trophy Room's other two tabs. Each is its own screen:
                    Badges are bought, Achievements are earned by training, and
                    Challenges were always a page of their own. */}
                <Route path="/badges" element={<Badges />} />
                <Route path="/vpr" element={<VPR />} />
                <Route path="/skills" element={<SkillAnalytics />} />
                <Route path="/tactics" element={<Tactics />} />
                <Route path="/development" element={<Development />} />
                <Route path="/identity" element={<Identity />} />
                <Route path="/injury" element={<Injury />} />
                {/* Legacy routes — duplicates / removed feature, keep as redirects so bookmarks don't 404 */}
                <Route path="/trophies" element={<Navigate to="/achievements" replace />} />
                {/* The workout screen, back as LOG ONLY (2026-10-08).

                    The screen deleted on 2026-10-05 could start a session as well
                    as record one, and starting one is a promise this build cannot
                    keep: no location permission is declared, so a live workout had
                    no distance and no route. It is restored for the half that
                    works — typing in a session that has already happened — and
                    nothing in it starts, times or tracks anything. */}
                <Route path="/workouts" element={<Workouts />} />
                <Route path="/stats" element={<Navigate to="/metrics" replace />} />
                <Route path="/load" element={<Navigate to="/metrics" replace />} />
                {/* Cross-Sport Analysis is a real screen as of 2026-10-12. It
                    was a redirect to /training while the unlock it sold had no
                    page behind it — the price was in the Market and the tab the
                    athlete had bought never appeared. The route is gated in
                    ROUTE_UNLOCKS, so it is paid-for and reachable only by an
                    athlete who owns it or is on Unlimited. */}
                <Route path="/cross-sport" element={<CrossSportAnalysis />} />
                <Route path="/competition" element={<Navigate to="/events" replace />} />
                {/* Removed 2026-10-08: surfaces that were broken, empty or
                    pointless in a closed test. Redirects rather than 404s, so an
                    installed app's shortcut or an old shared link still lands
                    somewhere real: Compete for rankings, Form Analysis for
                    technique.

                    /ar-overlay is the clearest case — it draws a camera overlay
                    and the APK declares no camera permission, so on the only
                    platform this build ships to it could never have worked. */}
                <Route path="/feed" element={<Navigate to="/" replace />} />
                {/* Friends was a redirect home between 2026-10-08's dead-code
                    pass and this restore. The redirect is replaced rather than
                    kept, because a redirect to "/" is what made the Goals card
                    and every shared friend link a dead end. */}
                <Route path="/friends" element={<Friends />} />
                <Route path="/friends/:friendId" element={<FriendChat />} />
                <Route path="/communities" element={<Navigate to="/" replace />} />
                <Route path="/leaderboard" element={<Navigate to="/compete" replace />} />
                <Route path="/opponents" element={<Navigate to="/compete" replace />} />
                <Route path="/ar-overlay" element={<Navigate to="/form" replace />} />
                
                {/* Removed: the standalone cross-training tab. Cross-training is
                    prescribed inside the plan itself from the equipment answered
                    at setup, so these land on the plan. Same for /routines. */}
                <Route path="/cross-training" element={<Navigate to="/training" replace />} />
                <Route path="/learning" element={<Learning />} />
                <Route path="/learning/:lessonId" element={<LearningArticle />} />
                <Route path="/metrics" element={<MetricsHub />} />
                <Route path="/compare" element={<Compare />} />
                <Route path="/avatar" element={<Avatar />} />
                <Route path="/goals" element={<Goals />} />
                {/* Guardian access. One screen for both directions of the link:
                    an athlete who shares their training with a parent, and that
                    parent reading the sanitized summary of it. The permissions
                    themselves are enforced in Postgres, not here. */}
                <Route path="/guardian" element={<Guardian />} />
                {/* The Wearables screen is gone: Health Connect lives in a sheet now
                    (HealthConnectPrompt). Old /health-sync links redirect to Recover
                    rather than 404, so a stale link or shortcut lands somewhere real. */}
                <Route
                  path="/health-sync"
                  element={
                    <Navigate to="/recover" replace />
                  }
                />
                {/* "Your Vaylo Starting Analysis". Deliberately NOT behind the
                    wearableSync flag: the analysis reads whatever training is in
                    the account, and Health Connect imports land in it too. */}
                <Route path="/starting-analysis" element={<StartingAnalysis />} />
                {/* Phase 6: the refined analytics reading, and the "why" behind
                    every recommendation it shows. Reads any training, so it is
                    not behind the wearableSync flag either. */}
                <Route path="/insights" element={<Insights />} />
                <Route path="/pbs" element={<PBs />} />
                <Route path="/routines" element={<Navigate to="/training" replace />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/profile/notifications" element={<NotificationPrefs />} />
                <Route path="/referrals" element={<Referrals />} />
                {/* Coach marketplace is launch-gated (featureFlags.ts). When off,
                    every route redirects to the Market so old links never 404.

                    Coach studio is the coach's own side — set a price, publish a
                    plan, deliver what was bought. It is inside the same gate and
                    is NOT advertised anywhere while the flag is off, which is what
                    makes "built but hidden" true for the app half of this feature
                    rather than aspirational. */}
                {isFlagOn("coachMarketplace") ? (
                  <>
                    <Route path="/market/become-creator" element={<BecomeCreator />} />
                    <Route path="/marketplace" element={<CreatorMarketplace />} />
                    <Route path="/coach-studio" element={<CoachStudio />} />
                    {/* The one payment Stripe takes, on the web only. The website's
                        coach page links here; the Android shell shows where to do
                        it instead of opening a payment sheet. */}
                    <Route path="/coach-signup" element={<CoachSignup />} />
                  </>
                ) : (
                  <>
                    <Route path="/market/become-creator" element={<Navigate to="/market" replace />} />
                    <Route path="/marketplace" element={<Navigate to="/market" replace />} />
                    <Route path="/coach-studio" element={<Navigate to="/market" replace />} />
                    <Route path="/coach-signup" element={<Navigate to="/market" replace />} />
                  </>
                )}
                
                {/* Admin screens verify the role server-side before rendering
                    anything (the tables' RLS was already admin-only; this
                    replaces silent query errors with an explicit no-access
                    state). */}
                <Route path="/admin/pricing" element={<RequireAdmin><AdminPricing /></RequireAdmin>} />
                <Route path="/admin/rewards" element={<RequireAdmin><AdminRewards /></RequireAdmin>} />
                <Route path="/admin/event-packs" element={<RequireAdmin><AdminEventPacks /></RequireAdmin>} />
                <Route path="/admin/waitlist" element={<RequireAdmin><AdminWaitlist /></RequireAdmin>} />
                <Route path="/admin/errors" element={<RequireAdmin><AdminErrorReports /></RequireAdmin>} />
                {/* Reached from the emailed secure link (/admin/refunds?case=RF-…).
                    RequireAdmin is the visible gate; refund-admin re-checks the
                    role on every request, so the URL alone grants nothing. */}
                <Route path="/admin/refunds" element={<RequireAdmin><AdminRefunds /></RequireAdmin>} />
                <Route path="/settings/purchases" element={<PurchasesRefunds />} />
                <Route path="/collection" element={<Collection />} />
                <Route path="/ai-dev" element={<RequireAdmin><AIDev /></RequireAdmin>} />
                <Route path="/pipeline" element={<RequireAdmin><PipelineDashboard /></RequireAdmin>} />
                <Route path="/settings/delete-account" element={<DeleteAccount />} />
                <Route path="/legal" element={<Legal />} />
                <Route path="/safety" element={<Safety />} />


                <Route path="/challenges" element={<Challenges />} />
                <Route path="/challenges/:id" element={<ChallengeDetail />} />
              </Route>
              <Route path="*" element={<NotFound />} />
              </Routes>

            </Suspense>
            <PaywallModal />
            <CreditTopUpSheet />
            <MilestoneCelebration />
          </SubscriptionProvider>
        </AuthProvider>
      </Router>
    </TooltipProvider>
  </QueryClientProvider>
    </MotionConfig>
  </ErrorBoundary>
  );
};

export default App;
