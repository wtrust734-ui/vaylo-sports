import { useNavigate } from "react-router-dom";
import { Bot, HeartPulse, Users, AlertTriangle, ArrowLeft } from "lucide-react";
import { legalPath } from "@/lib/legalUrls";
import { AUDIENCE_COPY, AUDIENCE_NOT_ENFORCED_COPY } from "@/lib/age";

// ============================================================================
// SAFETY INFORMATION
// ----------------------------------------------------------------------------
// Three things the app does that carry real-world risk, explained plainly to
// the person most likely to be harmed by them:
//
//   1. AI output  — generated text about training, injury and food. It can be
//                   wrong, and confident in being wrong; the app's own disclaimers
//                   are the only thing standing between that and an injury.
//   2. Training   — load, recovery and injury screens. Vaylo is not a clinician
//                   and cannot see the athlete.
//   3. Community  — the feed, challenges, communities and leaderboards are other
//                   people, and every one of them is a stranger.
//
// Written in plain language, because a safety notice nobody can read is not a
// safety notice, and it still has to serve the under-18 accounts the app does
// not target but also does not turn away. Every claim here is checkable against
// the app's actual behaviour; nothing is aspirational.
//
// Deliberately NOT included: a blanket "we accept no responsibility". The Terms
// already say what is and isn't our responsibility, and an over-broad
// disclaimer is both unenforceable and, in practice, read by nobody.
// ============================================================================

const Safety = () => {
  const navigate = useNavigate();

  return (
    <div className="mx-auto w-full max-w-3xl px-5 pt-[var(--vaylo-screen-top)] pb-24">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} /> Back
      </button>

      <h1 className="text-2xl font-bold tracking-tight">Safety Information</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        How to use Vaylo Sports without getting hurt, and how to keep yourself and others safe.
      </p>
      <p className="mt-3 rounded-xl border border-border bg-card p-3 text-sm leading-relaxed">
        {AUDIENCE_COPY} {AUDIENCE_NOT_ENFORCED_COPY}
      </p>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-6" id="ai">
        <Section icon={Bot} title="What our AI does — and doesn't do">
          <Callout tone="warning">
            <strong>Vaylo is not a doctor, physiotherapist or coach.</strong> Nothing in this app is
            medical advice, and no part of it can replace seeing a real professional.
          </Callout>

          <p>Our coaching features are written by a large language model. That means:</p>
          <ul>
            <li>
              <strong>It can be wrong.</strong> Not occasionally wrong — confidently, fluently wrong.
              It will not tell you it is unsure.
            </li>
            <li>
              <strong>It cannot see you.</strong> It knows what you have logged, not how you move, how
              you feel, or what's actually happening.
            </li>
            <li>
              <strong>It does not know your medical history</strong>, your medication, or a condition
              you've never mentioned.
            </li>
          </ul>

          <p className="font-semibold">Stop and see a professional if:</p>
          <ul>
            <li>You have sharp, worsening or persistent pain</li>
            <li>You have an injury, or are returning from one</li>
            <li>You are pregnant, or have a medical condition affecting exercise</li>
            <li>You are under 18 and thinking about a restrictive diet</li>
            <li>Anything about the app's advice makes you feel worse, not better</li>
          </ul>

          <p>
            Injury Management in this app produces a <em>generic</em> return-to-play scaffold, not a
            diagnosis. Nutrition planning is restricted to athletes aged 18 and over for this reason.
          </p>
        </Section>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-6" id="training">
        <Section icon={HeartPulse} title="Training safely">
          <p>
            Vaylo calculates training load, recovery and readiness from what you log. Those numbers
            describe <em>your data</em>, not your body. A readiness score of 40 doesn't mean you're
            injured, and 90 doesn't mean you're fine.
          </p>
          <ul>
            <li>
              <strong>Progress slowly.</strong> Vaylo can't see how much you actually did, so it can't
              stop you doing too much.
            </li>
            <li>
              <strong>Rest days are data too.</strong> Logging easy days and full rest keeps your
              numbers honest.
            </li>
            <li>
              <strong>Under 18s get age-adjusted loads</strong> automatically. Don't override them
              because a plan looks easy.
            </li>
            <li>
              <strong>Don't use a challenge or leaderboard as a target</strong> when you are injured or
              recovering. They're motivation, not prescription.
            </li>
            <li>
              <strong>Hydration and food are yours to judge.</strong> The app can log them; it cannot
              tell you if you're eating enough.
            </li>
          </ul>
          <Callout tone="warning">
            If you are under 18 and someone is pressuring you to restrict food or training, that is
            not normal coaching. Talk to a parent, a teacher or a doctor.
          </Callout>
        </Section>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-6" id="community">
        <Section icon={Users} title="Community Guidelines">
          <p>
            The feed, communities, challenges and leaderboards contain content from other people,
            including people your age. Be decent, and expect the same.
          </p>

          <p className="font-semibold">Never acceptable, and always reported:</p>
          <ul>
            <li>Bullying, threats, or targeting anyone for who they are</li>
            <li>
              Racist, sexist, homophobic, transphobic or otherwise hateful content
            </li>
            <li>Sexual content, or sexualising anyone — especially a child</li>
            <li>Encouraging self-harm, disordered eating, or dangerous training</li>
            <li>Doxxing: posting someone's address, school or phone number</li>
            <li>Impersonating Vaylo Sports, a coach, or another athlete</li>
            <li>Spam, advertising, scams, or links to unsafe downloads</li>
          </ul>

          <p className="font-semibold">Also worth knowing:</p>
          <ul>
            <li>
              <strong>What you share is yours to control.</strong> You decide what goes on the feed —
              nothing is published without you pressing Share.
            </li>
            <li>
              <strong>Your profile is private by default</strong>, especially if you're under 18. You
              can change this in Privacy settings, but we recommend leaving it.
            </li>
            <li>
              <strong>Sponsored content is never shown to under-18s</strong>, and is always labelled
              when it appears. It is not part of any training plan, and nothing in it is medical or
              professional advice.
            </li>
            <li>
              <strong>Credits are not money.</strong> They have no cash value and can't be sold,
              traded or refunded for cash.
            </li>
          </ul>

          <p className="font-semibold">If something's wrong</p>
          <p>
            Tap the small <strong>flag icon</strong> on any shared activity or profile and tell us
            what's wrong. A person reads every report, and we'll tell you what we did. If you'd rather
            not be in contact with that person at all, tap the <strong>block</strong> button next to
            it — you stop seeing them immediately, and they'll never know.
          </p>
          <Callout tone="info">
            If you're in immediate danger, contact emergency services first. This app is not a route
            to urgent help.
          </Callout>
        </Section>
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="mt-6 rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">More detail</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          This page is the short version. The Privacy Policy explains exactly what we
          collect, who else processes it, and how long we keep it. The AI &amp; Coaching
          Disclaimer, the Training &amp; Health Safety Notice and the Child &amp; Young
          Athlete Safety policy go into full.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <DocLink to={legalPath("privacy")} label="Privacy Policy" />
          <DocLink to={legalPath("ai-disclaimer")} label="AI &amp; Coaching Disclaimer" />
          <DocLink to={legalPath("health-safety")} label="Training &amp; Health Safety" />
          <DocLink to={legalPath("child-safety")} label="Child &amp; Young Athlete Safety" />
          <button
            type="button"
            onClick={() => navigate("/legal")}
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold transition-colors hover:bg-muted/60"
          >
            All documents
          </button>
        </div>
      </section>
    </div>
  );
};

const Section = ({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Bot;
  title: string;
  children: React.ReactNode;
}) => (
  <div className="rounded-2xl border border-border bg-card p-5">
    <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
      <Icon size={18} className="text-primary" />
      {title}
    </h2>
    <div className="legal-body mt-3 space-y-3 text-sm leading-relaxed text-foreground/90 [&_li]:ml-4 [&_li]:list-disc [&_p]:text-foreground/85">
      {children}
    </div>
  </div>
);

/**
 * An in-app document link: opens the published page in the app's own viewer
 * (src/pages/LegalDocument.tsx). A button rather than an anchor on purpose —
 * a root-absolute href would be a document load past the /play/ mount in the
 * web build, which lands on the marketing site's 404 (see playMount.test.ts).
 */
const DocLink = ({ to, label }: { to: string; label: string }) => {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-semibold transition-colors hover:bg-muted/60"
    >
      {label}
    </button>
  );
};

const Callout = ({
  tone,
  children,
}: {
  tone: "warning" | "info";
  children: React.ReactNode;
}) => (
  <div
    className={`flex gap-2.5 rounded-xl border p-3 text-xs leading-relaxed ${
      tone === "warning"
        ? "border-energy/40 bg-energy/5 text-foreground/90"
        : "border-primary/30 bg-primary/5 text-foreground/90"
    }`}
  >
    {tone === "warning" ? (
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-energy" />
    ) : (
      <HeartPulse size={14} className="mt-0.5 shrink-0 text-primary" />
    )}
    <div>{children}</div>
  </div>
);

export default Safety;
