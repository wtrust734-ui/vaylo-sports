import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import { MotionConfig } from "framer-motion";
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { isNativeShell, loadPlugin } from "@/lib/platform";
import { isFlagOn } from "@/config/featureFlags";
import { consumeBackPress } from "@/lib/backButton";
// Single toast renderer: sonner. The shadcn <Toaster/> and the reducer behind it
// were removed — src/hooks/use-toast.ts now forwards to sonner.
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import AppLayout from "@/components/layout/AppLayout";
import ErrorBoundary from "@/components/ErrorBoundary";
import CreditWarning from "@/components/ads/CreditWarning";
import PromoPopup from "@/components/ads/PromoPopup";
import StreakShield from "@/components/ads/StreakShield";
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

import OfflineBanner from "@/components/OfflineBanner";

import Auth from "./pages/Auth";
import Onboarding from "./pages/Onboarding";
import Index from "./pages/Index";
const Training = lazy(() => import("./pages/Training"));
const Workouts = lazy(() => import("./pages/Workouts"));
const Nutrition = lazy(() => import("./pages/Nutrition"));
const Mental = lazy(() => import("./pages/Mental"));
const Coach = lazy(() => import("./pages/Coach"));
const Profile = lazy(() => import("./pages/Profile"));
const Recovery = lazy(() => import("./pages/Recovery"));
const Market = lazy(() => import("./pages/Market"));
const FormAnalysis = lazy(() => import("./pages/FormAnalysis"));
const VideoFormAnalysis = lazy(() => import("./pages/VideoFormAnalysis"));
const Arcade = lazy(() => import("./pages/Arcade"));
const Events = lazy(() => import("./pages/Events"));
const Friends = lazy(() => import("./pages/Friends"));
const Pricing = lazy(() => import("./pages/Pricing"));
const Subscription = lazy(() => import("./pages/Subscription"));
const EventPacks = lazy(() => import("./pages/EventPacks"));
const Achievements = lazy(() => import("./pages/Achievements"));
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

const CrossTraining = lazy(() => import("./pages/CrossTraining"));
const Learning = lazy(() => import("./pages/Learning"));
const LearningArticle = lazy(() => import("./pages/LearningArticle"));
const MetricsHub = lazy(() => import("./pages/MetricsHub"));
const Compare = lazy(() => import("./pages/Compare"));
const ArOverlay = lazy(() => import("./pages/ArOverlay"));
const Avatar = lazy(() => import("./pages/Avatar"));
const Communities = lazy(() => import("./pages/Communities"));
const Goals = lazy(() => import("./pages/Goals"));
const HealthSync = lazy(() => import("./pages/HealthSync"));

const Feed = lazy(() => import("./pages/Feed"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const PublicProfile = lazy(() => import("./pages/PublicProfile"));
const PBs = lazy(() => import("./pages/PBs"));
const Routines = lazy(() => import("./pages/Routines"));
const Opponents = lazy(() => import("./pages/Opponents"));
const AdminPricing = lazy(() => import("./pages/AdminPricing"));
const AdminRewards = lazy(() => import("./pages/AdminRewards"));
const AdminEventPacks = lazy(() => import("./pages/AdminEventPacks"));
const EventPackLanding = lazy(() => import("./pages/EventPackLanding"));
const Challenges = lazy(() => import("./pages/Challenges"));
const ChallengeDetail = lazy(() => import("./pages/ChallengeDetail"));
const Collection = lazy(() => import("./pages/Collection"));
const AIDev = lazy(() => import("./pages/AIDev"));
const DeleteAccount = lazy(() => import("./pages/DeleteAccount"));

const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

// Inside the Capacitor shell the app is served as a local bundle, where a deep
// link or a refresh on /training has no server to fall back to. Hash routing is
// the safe default there; the web build keeps clean URLs.
const Router = isNativeShell() ? HashRouter : BrowserRouter;

/**
 * Android's back button, wired through the Capacitor App plugin.
 *
 * Priority: an open overlay claims the press → otherwise normal history back →
 * at a root screen, send the app to the background (what Android users expect)
 * instead of hard-exiting. No-ops on the web and while the plugin is absent.
 */
const NativeBackButton = () => {
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

  return null;
};

const App = () => (
  <ErrorBoundary>
    <MotionConfig reducedMotion="user">
    <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      <NativeBackButton />
      <Router>
        <AuthProvider>
          <SubscriptionProvider>
            <OfflineBanner />
            <Suspense fallback={<div className="min-h-screen bg-background" />}>

              <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route path="/onboarding" element={<Onboarding />} />
              {/* Public viral surfaces — must render without a session (they
                  carry the join / signup CTAs). Shared links reach them via the
                  link-preview function's redirect. */}
              <Route path="/c/:id" element={<ChallengeInvite />} />
              <Route path="/referral-leaderboard" element={<ReferralLeaderboard />} />
              <Route path="/discord" element={<DiscordCommunity />} />
              <Route element={<AppLayout />}>
                <Route path="/" element={<Index />} />
                {/* Information-architecture hubs: every tile navigates to an
                    existing page; these only group destinations. */}
                <Route path="/train" element={<Train />} />
                <Route path="/perform" element={<Perform />} />
                <Route path="/recover" element={<Recover />} />
                <Route path="/compete" element={<Compete />} />
                <Route path="/training" element={<Training />} />
                <Route path="/workouts" element={<Workouts />} />
                <Route path="/nutrition" element={<Nutrition />} />
                <Route path="/form" element={<FormAnalysis />} />
                <Route path="/form/video" element={<VideoFormAnalysis />} />
                <Route path="/mental" element={<Mental />} />
                <Route path="/coach" element={<Coach />} />
                <Route path="/arcade" element={<Arcade />} />
                <Route path="/events" element={<Events />} />
                <Route path="/friends" element={<Friends />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/profile/:username" element={<PublicProfile />} />
                <Route path="/recovery" element={<Recovery />} />
                <Route path="/market" element={<Market />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/subscription" element={<Subscription />} />
                <Route path="/event-packs" element={<EventPacks />} />
                <Route path="/packs/:packId" element={<EventPackLanding />} />
                <Route path="/achievements" element={<Achievements />} />
                <Route path="/vpr" element={<VPR />} />
                <Route path="/skills" element={<SkillAnalytics />} />
                <Route path="/tactics" element={<Tactics />} />
                <Route path="/development" element={<Development />} />
                <Route path="/identity" element={<Identity />} />
                <Route path="/injury" element={<Injury />} />
                {/* Legacy routes — duplicates / removed feature, keep as redirects so bookmarks don't 404 */}
                <Route path="/trophies" element={<Navigate to="/achievements" replace />} />
                <Route path="/stats" element={<Navigate to="/metrics" replace />} />
                <Route path="/load" element={<Navigate to="/metrics" replace />} />
                <Route path="/cross-sport" element={<Navigate to="/cross-training" replace />} />
                <Route path="/competition" element={<Navigate to="/events" replace />} />
                
                <Route path="/cross-training" element={<CrossTraining />} />
                <Route path="/learning" element={<Learning />} />
                <Route path="/learning/:lessonId" element={<LearningArticle />} />
                <Route path="/metrics" element={<MetricsHub />} />
                <Route path="/compare" element={<Compare />} />
                <Route path="/ar-overlay" element={<ArOverlay />} />
                <Route path="/avatar" element={<Avatar />} />
                <Route path="/communities" element={<Communities />} />
                <Route path="/goals" element={<Goals />} />
                <Route path="/health-sync" element={<HealthSync />} />
                <Route path="/feed" element={<Feed />} />
                <Route path="/leaderboard" element={<Leaderboard />} />
                <Route path="/pbs" element={<PBs />} />
                <Route path="/routines" element={<Routines />} />
                <Route path="/opponents" element={<Opponents />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/profile/notifications" element={<NotificationPrefs />} />
                <Route path="/referrals" element={<Referrals />} />
                {/* Coach marketplace is launch-gated (featureFlags.ts). When off,
                    both routes redirect to the Market so old links never 404. */}
                {isFlagOn("coachMarketplace") ? (
                  <>
                    <Route path="/market/become-creator" element={<BecomeCreator />} />
                    <Route path="/marketplace" element={<CreatorMarketplace />} />
                  </>
                ) : (
                  <>
                    <Route path="/market/become-creator" element={<Navigate to="/market" replace />} />
                    <Route path="/marketplace" element={<Navigate to="/market" replace />} />
                  </>
                )}
                
                <Route path="/admin/pricing" element={<AdminPricing />} />
                <Route path="/admin/rewards" element={<AdminRewards />} />
                <Route path="/admin/event-packs" element={<AdminEventPacks />} />
                <Route path="/collection" element={<Collection />} />
                <Route path="/ai-dev" element={<AIDev />} />
                <Route path="/settings/delete-account" element={<DeleteAccount />} />


                <Route path="/challenges" element={<Challenges />} />
                <Route path="/challenges/:id" element={<ChallengeDetail />} />
              </Route>
              <Route path="*" element={<NotFound />} />
              </Routes>

            </Suspense>
            <CreditWarning />
            <PaywallModal />
            <PromoPopup />
            <StreakShield />
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

export default App;
