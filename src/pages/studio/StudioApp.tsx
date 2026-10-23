import { useEffect, useState } from "react";
import {
  Image,
  Video,
  FlaskConical,
  Megaphone,
  Library,
  Palette,
  Plug,
  MessageSquare,
  Home as HomeIcon,
  Loader2,
  LogIn,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import HomeView from "./HomeView";
import ChatView from "./ChatView";
import BetaOnboarding, { reopenOnboarding } from "./BetaOnboarding";
import BetaFeedback from "./BetaFeedback";
import ImageAdsView from "./ImageAdsView";
import VideoAdsView from "./VideoAdsView";
import ResearchView from "./ResearchView";
import CampaignsView from "./CampaignsView";
import LibraryView from "./LibraryView";
import BrandView from "./BrandView";
import IntegrationsView from "./IntegrationsView";

export type StudioView =
  | "home"
  | "chat"
  | "image"
  | "video"
  | "research"
  | "campaigns"
  | "library"
  | "brand"
  | "integrations";

export const NAV: { id: StudioView; label: string; icon: typeof HomeIcon }[] = [
  { id: "home", label: "Home", icon: HomeIcon },
  { id: "chat", label: "Creative Assistant", icon: MessageSquare },
  { id: "image", label: "Image Ads", icon: Image },
  { id: "video", label: "Video Ads", icon: Video },
  { id: "research", label: "Competitor Research", icon: FlaskConical },
  { id: "campaigns", label: "Campaigns", icon: Megaphone },
  { id: "library", label: "Asset Library", icon: Library },
  { id: "brand", label: "Brand Settings", icon: Palette },
  { id: "integrations", label: "Integrations", icon: Plug },
];

// Dark navy/black foundation, restrained purple accent — the brand palette.
const PANEL_BG = "bg-[#07090f]";
const SURFACE = "bg-white/5 border border-white/10";
const ACCENT = "bg-[#8505D5] text-white";

function SignInCard({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (mode: "in" | "up") => {
    setBusy(true);
    setError(null);
    try {
      const { error } =
        mode === "in"
          ? await supabase.auth.signInWithPassword({ email, password })
          : await supabase.auth.signUp({ email, password });
      if (error) throw error;
      onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex min-h-screen items-center justify-center p-4 ${PANEL_BG}`}>
      <Card className={`w-full max-w-sm ${SURFACE}`}>
        <CardHeader>
          <CardTitle className="text-white">Sign in to Vaylo Ads Studio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-white">
          <Input
            className="bg-black/40"
            type="email"
            placeholder="you@studio.example"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            className="bg-black/40"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && submit("in")}
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <Button className={`w-full ${ACCENT}`} disabled={busy || !email || password.length < 6} onClick={() => submit("in")}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Sign in
          </Button>
          <Button variant="outline" className="w-full border-white/20 text-white" disabled={busy} onClick={() => submit("up")}>
            Create account
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function StudioApp() {
  const [session, setSession] = useState<null | boolean>(null); // null = checking
  const [view, setView] = useState<StudioView>("home");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // A video-ad brief written in the Creative Assistant, waiting for the Video
  // Ads workspace to pick it up. Cleared the moment the brief lands.
  const [videoBriefFromChat, setVideoBriefFromChat] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(Boolean(data.session)));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(Boolean(s)));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === null) {
    return (
      <div className={`flex min-h-screen items-center justify-center ${PANEL_BG}`}>
        <Loader2 className="h-6 w-6 animate-spin text-white/70" />
      </div>
    );
  }
  if (session === false) return <SignInCard onSignedIn={() => setSession(true)} />;

  const title = NAV.find((n) => n.id === view)?.label ?? "Studio";

  return (
    <div className={`flex min-h-screen flex-col md:flex-row ${PANEL_BG} text-white`}>
      {/* Desktop sidebar */}
      <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r border-white/10 p-3 md:flex">
        <div className="mb-4 flex items-center gap-2 px-2">
          <span className={`rounded px-2 py-1 text-xs font-semibold ${ACCENT}`}>Vaylo</span>
          <span className="text-sm font-medium">Ads Studio</span>
        </div>
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => setView(n.id)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
              view === n.id ? `${ACCENT}` : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <n.icon className="h-4 w-4" /> {n.label}
          </button>
        ))}
      </aside>

      {/* Mobile nav: horizontal scroll of chips — touch-friendly, no menu overflow */}
      <nav className="flex items-center gap-2 overflow-x-auto border-b border-white/10 p-3 md:hidden">
        {NAV.map((n) => (
          <button
            key={n.id}
            onClick={() => setView(n.id)}
            className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-xs ${
              view === n.id ? ACCENT : `${SURFACE} text-white/70`
            }`}
          >
            <n.icon className="h-3.5 w-3.5" /> {n.label}
          </button>
        ))}
      </nav>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6">
          <h1 className="text-base font-semibold sm:text-lg">{title}</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { reopenOnboarding(); setView("home"); }}
              className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/20"
            >
              Guide
            </button>
            <button
              onClick={() => setFeedbackOpen(true)}
              className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/20"
            >
              Report a problem
            </button>
            <span className="hidden text-xs text-white/50 sm:block">Vaylo Sports Ads Studio</span>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {view === "home" && (
            <div className="space-y-6">
              <BetaOnboarding onNavigate={setView} />
              <HomeView onNavigate={setView} />
            </div>
          )}
          {view === "chat" && (
            <ChatView
              onOpenVideoWorkflow={(brief) => {
                setVideoBriefFromChat(brief);
                setView("video");
              }}
            />
          )}
          {view === "image" && <ImageAdsView onOpenChat={() => setView("chat")} />}
          {view === "video" && (
            <VideoAdsView
              onOpenChat={() => setView("chat")}
              chatBrief={videoBriefFromChat}
              onConsumeChatBrief={() => setVideoBriefFromChat(null)}
            />
          )}
          {view === "research" && <ResearchView onOpenChat={() => setView("chat")} />}
          {view === "campaigns" && <CampaignsView />}
          {view === "library" && <LibraryView />}
          {view === "brand" && <BrandView />}
          {view === "integrations" && <IntegrationsView />}
        </div>
      </main>
      <BetaFeedback view={title} open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  );
}
