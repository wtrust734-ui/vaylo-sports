// ============================================================================
// BetaOnboarding — the short "start here" card a first-run user sees.
// ----------------------------------------------------------------------------
// Deliberately NOT a wizard or a form: six points, each one a sentence, each
// linking straight to the view that does it. Skippable (the card only shows
// until dismissed) and returnable (the sidebar's Guide button re-opens it).
// Provider usage is stated plainly — whose money pays for what — because §6 of
// the beta plan requires testers to understand spend before it happens. There
// is no credit balance: a generation runs when you press Run.
// ============================================================================

import { useState } from "react";
import { Image, Video, FlaskConical, Megaphone, Library, Plug, MessageSquare, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { StudioView } from "./StudioApp";

const STORAGE_KEY = "ads_onboarded_v1";

export function onboardingDismissed(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function reopenOnboarding(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage may be unavailable; the card simply re-appears next mount */
  }
}

const POINTS: { icon: typeof Image; title: string; body: string; view?: StudioView }[] = [
  { icon: MessageSquare, title: "Ask in plain words", body: "The Creative Assistant routes your request — research, image ad, video ad, revision or a question — and tells you exactly what it will do before it starts.", view: "chat" },
  { icon: Image, title: "Image ads", body: "Write a brief, pick a concept, generate backgrounds, compose with your brand text, then export. Each generated background is made when you ask for it — there is nothing to buy.", view: "image" },
  { icon: Video, title: "Video ads", body: "The concept step writes script and storyboard; shots, narration and render follow in one run. Rendering needs a hosted worker — the app says so when it is missing.", view: "video" },
  { icon: FlaskConical, title: "Competitor research", body: "Public pages, press and manual sources. Findings keep their links; ad-platform ad libraries stay marked unavailable until approvals exist.", view: "research" },
  { icon: Megaphone, title: "Campaigns & assets", body: "Campaigns hold concepts, assets and exports. The library stores every file you upload or generate, yours alone, private to your account.", view: "campaigns" },
  { icon: Plug, title: "Integrations", body: "Check what is configured and what is missing at any time. A listed provider is a configured key, not a verified capability — the panel says which is which.", view: "integrations" },
];

export default function BetaOnboarding({ onNavigate }: { onNavigate: (v: StudioView) => void }) {
  const [open, setOpen] = useState(() => !onboardingDismissed());

  if (!open) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  return (
    <Card className="border-[#8505D5]/40">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">Ads Studio beta — start here</h3>
            <p className="mt-0.5 text-xs text-white/50">Six things worth knowing. Skip anytime; reopen from <span className="text-white/70">Guide</span> in the sidebar.</p>
          </div>
          <button onClick={dismiss} aria-label="Dismiss onboarding" className="rounded p-1 text-white/50 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
        <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {POINTS.map((p) => (
            <li key={p.title}>
              <button
                onClick={() => (p.view ? onNavigate(p.view) : undefined)}
                className="flex w-full items-start gap-2 rounded-lg bg-black/20 p-2.5 text-left hover:bg-black/40"
              >
                <p.icon className="mt-0.5 h-4 w-4 shrink-0 text-[#b47ae8]" />
                <span className="min-w-0">
                  <span className="block text-xs font-medium">{p.title}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-white/50">{p.body}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-black/30 p-2.5 text-[11px] text-white/60">
          <Image className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <span>
            <strong className="text-white/80">No credits, no top-ups.</strong> Generations run when you press Run; model usage is billed
            to the provider account configured for this studio. The provider is the final word on what a generation costs.
          </span>
        </div>
        <p className="mt-2 text-[10px] text-white/30">Beta: features that are not connected are labelled as such in the app; nothing is simulated.</p>
      </CardContent>
    </Card>
  );
}
