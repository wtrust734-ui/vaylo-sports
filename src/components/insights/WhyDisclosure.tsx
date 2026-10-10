// ============================================================================
// WhyDisclosure — the one place a recommendation explains itself
// ----------------------------------------------------------------------------
// Progressive disclosure, in the order the athlete needs it:
//
//   1. the recommendation, in one line, always visible;
//   2. "Why" — the 2–5 data-driven bullets, each labelled with the record it
//      came from, behind a tap;
//   3. "What this means" — the consequence, not a restatement of the headline;
//   4. what to do about it, when there is something to do.
//
// It was extracted rather than written per screen because the same panel now
// appears on the Training plan, the analytics screen and the weekly report, and
// three hand-rolled copies is how one of them ends up explaining a decision
// differently from the rules that made it. The caller hands over an
// explanation; this renders it and adds nothing.
//
// Two details are deliberate:
//
//   • The confidence chip only appears when the evidence is thin. Labelling
//     every recommendation "well supported" trains the athlete to ignore the
//     label, and the case that needs it is the one where one fact is carrying
//     the whole argument.
//   • The closing line is always present. Every panel here is a suggestion
//     derived from logged training, and saying so is cheaper than being asked
//     whether Vaylo is a medical device.
// ============================================================================

import { useId, useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import {
  confidenceLabel,
  reasonSourceLabel,
  type ExplanationConfidence,
  type ExplanationReason,
  type ExplanationTone,
} from "@/lib/explanations";

/**
 * What this panel needs. Structural, not nominal, so both the explanation
 * framework's `RecommendationExplanation` and an analytics `InsightMetric` can
 * be rendered without either module depending on the other.
 */
export interface Explainable {
  headline: string;
  why: ExplanationReason[];
  rationale: string;
  tone: ExplanationTone;
  confidence: ExplanationConfidence;
  insufficient?: boolean;
  /** Bullets dropped by the framework's cap, reported rather than hidden. */
  omitted?: number;
  nextStep?: string | null;
}

export interface WhyDisclosureProps {
  explanation: Explainable;
  /** Open on first render — used for the lead card on a screen. */
  defaultOpen?: boolean;
  className?: string;
}

/**
 * The rule down the leading edge carries the tone; the words stay neutral.
 *
 * `border-s-*` rather than `border-l-*` so the rule follows the text direction:
 * in Arabic the panel reads right-to-left and a left-edge rule sits at the end
 * of every line instead of the start, which points at nothing.
 */
const ACCENT: Record<ExplanationTone, string> = {
  positive: "border-s-emerald-400",
  info: "border-s-sky-400",
  watch: "border-s-amber-400",
  safety: "border-s-destructive",
};

/**
 * The panel body, without a toggle.
 *
 * Exported because the Training screen already has its own disclosure — its
 * row is the whole panel — and nesting a second toggle inside an open one is
 * how an interface teaches people not to tap things. The reasons, the rationale
 * and the closing line are the same code either way, so the two surfaces cannot
 * drift apart.
 */
export const WhyBody = ({
  explanation,
  /**
   * Show the recommendation as well as its reasons.
   *
   * Off by default, because the caller usually has the headline on screen
   * already — inside a screen's own disclosure, repeating it is noise. It is on
   * for the Training plan panel, where the reasons belong to a SECOND
   * recommendation (the week's reduction) whose headline appears nowhere else,
   * and stating reasons without the sentence they justify reads as a list of
   * complaints.
   */
  showHeadline = false,
}: {
  explanation: Explainable;
  showHeadline?: boolean;
}) => {
  const { headline, why, rationale, insufficient, omitted, nextStep } = explanation;
  return (
    <div className="space-y-2">
      {showHeadline ? <p className="text-sm font-semibold">{headline}</p> : null}
      {insufficient && why.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{rationale}</p>
      ) : (
        <>
          {why.length > 0 && (
            <div className="border-t border-white/[0.06] pt-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Why
              </p>
              <ul className="mt-1 space-y-1.5">
                {why.map((reason) => (
                  <li key={reason.text} className="text-[12px] leading-relaxed">
                    <span className="text-foreground/90">· {reason.text}</span>
                    <span className="block text-[11px] text-muted-foreground/70">
                      {reasonSourceLabel(reason.source)}
                    </span>
                  </li>
                ))}
              </ul>
              {omitted && omitted > 0 ? (
                <p className="mt-1 text-[11px] text-muted-foreground/70">
                  +{omitted} more, in your plan detail.
                </p>
              ) : null}
            </div>
          )}

          <div className="border-t border-white/[0.06] pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              What this means
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-foreground/90">{rationale}</p>
          </div>
        </>
      )}

      {nextStep ? (
        <p className="text-[12px] leading-relaxed text-foreground">
          <span className="font-semibold">Next: </span>
          {nextStep}
        </p>
      ) : null}

      <p className="text-[11px] text-muted-foreground/70">
        From your own logged training — not a medical assessment.
      </p>
    </div>
  );
};

const WhyDisclosure = ({
  explanation,
  defaultOpen = false,
  className = "",
}: WhyDisclosureProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const { headline, tone, confidence } = explanation;

  return (
    <div
      className={`rounded-xl border border-s-2 border-border/60 bg-card/40 ${ACCENT[tone]} ${className}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        // `min-h-11` is not decoration: the 44px floor in index.css covers
        // buttons, but this one is styled as a row rather than a control, and
        // it is the control the whole panel hangs off.
        className="flex min-h-11 w-full items-start gap-2 p-3 text-start"
      >
        <Info size={14} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{headline}</span>
          {confidence === "low" || confidence === "none" ? (
            // Only shown when it is true and it matters.
            <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {confidenceLabel(confidence)}
            </span>
          ) : null}
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          className={`mt-0.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div id={panelId} className="px-3 pb-3">
          <WhyBody explanation={explanation} />
        </div>
      )}
    </div>
  );
};

export default WhyDisclosure;
