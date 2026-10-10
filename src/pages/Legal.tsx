import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShieldCheck, FileText, Scale, Trash2, Download, Loader2, AlertTriangle,
  Users, Bot, HeartPulse, Check, X, Mail, ChevronRight, Lock,
} from "lucide-react";
import { legalPath, type LegalSlug } from "@/lib/legalUrls";
import { useAuth } from "@/contexts/AuthContext";
import { ageBand } from "@/lib/age";
import { requestMyData, downloadExport, fetchMyReports, type PortabilityExport } from "@/lib/safety";
import { formatDate, formatDateTimeExact } from "@/i18n/format";

// ============================================================================
// LEGAL & SAFETY CENTRE
// ----------------------------------------------------------------------------
// The single place an athlete can reach every legal document, every right they
// have, and every safety control. Before this, the privacy policy was reachable
// only from the sign-up screen and Profile settings, and reporting, community
// rules, AI limitations and data portability did not exist in the app at all.
//
// Built from what the codebase actually does. Where a fact is not in the
// repository — the registered company number, the postal address, the
// retention periods — it is shown as "not yet stated" rather than invented. A
// privacy centre that quietly fabricates a company number is worse than one that
// admits the gap.
// ============================================================================

const CONTACT_EMAIL = "vaylosportsupport@gmail.com";

/**
 * Every published document, so nothing is reachable only from one screen.
 *
 * The tiles below are the doors an athlete actually walks through; this is the
 * full set behind them. Keeping the list here rather than repeating links on
 * individual screens means a document added to legal/ shows up here rather than
 * becoming a page that exists on the web and nowhere in the app.
 *
 * Order matches the generator so the two read the same way.
 */
const LIBRARY: Array<{ slug: LegalSlug; title: string; blurb: string }> = [
  { slug: "privacy", title: "Privacy Policy", blurb: "What we collect, why, and who else processes it" },
  { slug: "terms", title: "Terms of Service", blurb: "The agreement between you and Vaylo Sports" },
  { slug: "ai-disclaimer", title: "AI & Coaching Disclaimer", blurb: "What the AI features are, and what they cannot do" },
  { slug: "health-safety", title: "Training & Health Safety", blurb: "How to read the numbers, and when to stop" },
  { slug: "community-guidelines", title: "Community Guidelines", blurb: "What is acceptable in the feed and communities" },
  { slug: "child-safety", title: "Child & Young Athlete Safety", blurb: "What is switched off for under-18s" },
  { slug: "advertising", title: "Advertising & Tracking", blurb: "What brands see — which is very little" },
  { slug: "purchases", title: "Credits & Subscriptions", blurb: "Virtual currency, and what buying does not give you" },
  { slug: "refunds", title: "Refunds & Cancellation", blurb: "How to cancel, and when we will refund you" },
  { slug: "account-deletion", title: "Deleting Your Account", blurb: "Every step of the deletion, and what survives" },
  { slug: "data-rights", title: "Your Data Rights", blurb: "Access, correction, export, erasure and complaints" },
  { slug: "intellectual-property", title: "Intellectual Property", blurb: "What you own, what we own, copyright complaints" },
  { slug: "cookies", title: "Cookie Policy", blurb: "The one cookie we set, and the settings on your device" },
  { slug: "competition-terms", title: "Competitions & Promotions", blurb: "How challenges, leaderboards and referrals work" },
  { slug: "waitlist-terms", title: "Waiting List Terms", blurb: "What joining the waiting list does and does not mean" },
  { slug: "report-safety-concern", title: "Report a Safety Concern", blurb: "If someone is unsafe, or a child is at risk" },
  { slug: "report-content", title: "Report Content or a User", blurb: "What the report button does, and blocking" },
  { slug: "security-disclosure", title: "Security & Vulnerability Reporting", blurb: "Safe harbour, and where to send a flaw" },
  { slug: "complaints", title: "Complaints Procedure", blurb: "How to complain, get a review, or go to a regulator" },
  { slug: "ai-training-advice", title: "AI Training Advice", blurb: "Why the suggestions are not a coach or a doctor" },
  { slug: "video-analysis-disclaimer", title: "Video Analysis", blurb: "What a clip estimate can and cannot tell you" },
  { slug: "injury-guidance", title: "Injury & Return-to-Training", blurb: "When to stop, and the rough shape of coming back" },
  { slug: "nutrition-disclaimer", title: "Nutrition", blurb: "General information, and why it is not a diet plan" },
  { slug: "mental-wellbeing", title: "Mental Wellbeing", blurb: "Training and mood, and where to get real help" },
  { slug: "wearable-health-privacy", title: "Wearable & Health Data", blurb: "What a connected watch sends, and how to remove it" },
  { slug: "ai-data-use", title: "AI Data Use & Processing", blurb: "Exactly what is sent to an AI provider, and what is not" },
  { slug: "contact", title: "Contact & Support", blurb: "How to reach a person, and what is urgent" },
];

type Tile = { icon: typeof FileText; title: string; body: string; onClick?: () => void };

const Legal = () => {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const band = ageBand(profile?.date_of_birth);

  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<PortabilityExport | null>(null);
  const [exportError, setExportError] = useState("");
  const [reports, setReports] = useState<{ id: string; reason: string; created_at: string; status: string }[]>([]);

  useEffect(() => {
    if (!user) return;
    void fetchMyReports().then(setReports);
  }, [user]);

  const runExport = async () => {
    setExporting(true);
    setExportError("");
    try {
      const result = await requestMyData();
      if (!result) {
        setExportError("We couldn't build your export. Please try again in a moment.");
        return;
      }
      setExported(result);
      downloadExport(result);
    } finally {
      setExporting(false);
    }
  };

  const documents: Tile[] = [
    {
      icon: FileText,
      title: "Privacy Policy",
      body: "What we collect, why, who else sees it, how long we keep it, and your rights.",
      onClick: () => navigate(legalPath("privacy")),
    },
    {
      icon: Scale,
      title: "Terms of Service",
      body: "The agreement between you and Vaylo Sports, including credits, refunds and AI output.",
      onClick: () => navigate(legalPath("terms")),
    },
    {
      icon: ShieldCheck,
      title: "Safety Information",
      body: "What our AI can and cannot do, and how to train safely.",
      onClick: () => navigate("/safety"),
    },
    {
      icon: Users,
      title: "Community Guidelines",
      body: "What is and is not acceptable in the feed, communities and challenges.",
      onClick: () => navigate("/safety#community"),
    },
    {
      icon: Trash2,
      title: "Delete your account",
      body: "Erase your account and all its data, immediately and free.",
      // The deletion SCREEN, not the document about it: an athlete tapping
      // this row wants the action, and the document stays reachable in the
      // library below.
      onClick: () => navigate("/settings/delete-account"),
    },
  ];

  const rights: Tile[] = [
    {
      icon: Download,
      title: "Download your data",
      body: exporting
        ? "Building your export…"
        : exported
          ? exported.complete
            ? "Your file has been downloaded. It contains everything we hold about you."
            : "Your file has been downloaded, but it is PARTIAL — some tables could not be read. The list is shown below."
          : "Get a JSON file of everything we hold: your profile, training, health, social and purchase records.",
      onClick: exporting ? undefined : runExport,
    },
    {
      icon: Lock,
      title: "Privacy settings",
      body: "Control who can see your profile and avatar. Defaults to private.",
      onClick: () => navigate("/profile"),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl px-5 pt-[var(--vaylo-screen-top)] pb-24">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Legal &amp; Safety</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every document, every right, and every safety control — in one place.
        </p>
      </header>

      {/* ---- age band, because it changes what we do with you ---- */}
      <section className="mb-6 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck size={18} className="mt-0.5 shrink-0 text-primary" />
          <div className="text-sm">
            <p className="font-semibold">
              {band === "adult" && "You're treated as an adult (18+)"}
              {band === "minor" && "You're treated as under 18"}
              {band === "unknown" && "Your age isn't set"}
            </p>
            <p className="mt-1 leading-relaxed text-muted-foreground">
              {band === "adult" &&
                "Sponsored content may be shown to you, and it's always labelled. You can turn it off in Settings."}
              {band === "minor" &&
                "Sponsored content is switched off everywhere in the app, your profile is private by default, and training loads are adjusted for athletes under 18."}
              {band === "unknown" &&
                "Add your date of birth in Profile to confirm. Until then, sponsored content is not shown, because we can't prove you're an adult."}
            </p>
            {band !== "adult" && (
              <button
                type="button"
                onClick={() => navigate("/profile")}
                className="mt-2 text-primary underline underline-offset-2"
              >
                {band === "unknown" ? "Set your date of birth" : "Change your date of birth"}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ---- documents ---- */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Documents
        </h2>
        <div className="grid grid-cols-1 gap-2">
          {documents.map((d) => (
            <TileButton key={d.title} tile={d} />
          ))}
        </div>

        <details className="mt-2 rounded-xl border border-border bg-card">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-foreground">
            All {LIBRARY.length} legal documents
          </summary>
          <ul className="grid grid-cols-1 gap-px border-t border-border bg-border sm:grid-cols-2">
            {LIBRARY.map((doc) => (
              <li key={doc.slug} className="bg-card">
                <button
                  type="button"
                  onClick={() => navigate(legalPath(doc.slug))}
                  className="flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors hover:bg-muted"
                >
                  <span className="flex items-center gap-1 text-sm font-medium text-foreground">
                    {doc.title}
                    <ChevronRight size={13} className="text-muted-foreground" />
                  </span>
                  <span className="text-xs text-muted-foreground">{doc.blurb}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      </section>

      {/* ---- your rights ---- */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Your data and your rights
        </h2>
        <div className="grid grid-cols-1 gap-2">
          {rights.map((r) => (
            <TileButton key={r.title} tile={r} />
          ))}
        </div>

        {exported && !exported.complete && (
          <div className="mt-2 rounded-xl border border-energy/40 bg-energy/5 p-3 text-xs leading-relaxed">
            <p className="flex items-center gap-2 font-semibold text-energy">
              <AlertTriangle size={13} /> This export is incomplete
            </p>
            <ul className="mt-1.5 list-inside list-disc text-muted-foreground">
              {exported.unreadable.map((u) => (
                <li key={u.table}>
                  <code className="text-foreground">{u.table}</code> — {u.reason}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-muted-foreground">
              This is a fault on our side, not something you need to fix. Email us and we'll finish it
              by hand.
            </p>
          </div>
        )}

        {exportError && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {exportError}
          </p>
        )}

        {exported && (
          <p className="mt-2 text-xs text-muted-foreground">
            {exported.summary.tables_included} of {exported.summary.tables_expected} tables ·{" "}
            {exported.summary.total_rows} rows · exported{" "}
            {formatDateTimeExact(exported.exported_at)}
          </p>
        )}
      </section>

      {/* ---- reporting ---- */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Reporting and blocking
        </h2>
        <div className="rounded-2xl border border-border bg-card p-4 text-sm leading-relaxed">
          <p>
            Every shared activity, community and profile has a{" "}
            <span className="font-semibold">Report</span> button — the small flag icon. Choose a reason
            and, if you want, add a few words. A person reads every report.
          </p>
          <p className="mt-2">
            <span className="font-semibold">Blocking</span> is separate and immediate: you stop seeing
            that athlete's activity, and they can no longer send you friend requests. They are not told
            they were blocked.
          </p>
          {reports.length > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Reports you've sent
              </p>
              <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                {reports.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    {r.status === "open" ? (
                      <Loader2 size={11} className="text-energy" />
                    ) : r.status === "dismissed" ? (
                      <X size={11} />
                    ) : (
                      <Check size={11} className="text-success" />
                    )}
                    <span className="capitalize">{r.reason.replace("_", " ")}</span>
                    <span className="opacity-60">· {r.status}</span>
                    <span className="opacity-60">
                      · {formatDate(r.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* ---- contact + honest gaps ---- */}
      <section className="mb-6 rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Contact</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Questions, complaints, or a data request:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary underline underline-offset-2">
            {CONTACT_EMAIL}
          </a>
          . If you're under 13, email us and we'll delete the account.
        </p>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          You can complain to the Information Commissioner's Office at ico.org.uk if you're not happy
          with how we've handled your data.
        </p>
      </section>

      <section className="rounded-2xl border border-energy/30 bg-energy/5 p-4">
        <h2 className="text-sm font-semibold text-energy">What we have not published yet</h2>
        <ul className="mt-1.5 list-inside list-disc space-y-1 text-xs leading-relaxed text-muted-foreground">
          <li>Registered company name, company number and postal address</li>
          <li>ICO registration number</li>
          <li>Named data protection officer, if one is appointed</li>
          <li>Exact server-log retention periods</li>
        </ul>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          These are required of us and are not yet available to us to publish. We would rather say so
          here than print something untrue. Email us and we'll answer directly.
        </p>
      </section>
    </div>
  );
};

const TileButton = ({ tile }: { tile: Tile }) => {
  const Icon = tile.icon;
  return (
    <button
      type="button"
      disabled={!tile.onClick}
      onClick={tile.onClick}
      className="flex w-full items-start gap-3 rounded-2xl border border-border bg-card p-4 text-start transition-colors hover:bg-muted/40 disabled:opacity-60"
    >
      <Icon size={18} className="mt-0.5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{tile.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{tile.body}</p>
      </div>
      <ChevronRight size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
    </button>
  );
};

export default Legal;
