import { useMemo } from "react";
import { Clock } from "lucide-react";

import { estimatePlanSeconds, type EstimateSource, type PlanGenerationKind } from "@/lib/planTiming";

// ============================================================================
// PLAN WAIT ESTIMATE — the "how long will this take" line on the create form
// ----------------------------------------------------------------------------
// Plan creation is a tens-of-seconds wait, and the athlete should be able to
// start it knowing roughly what they are starting. This is the same estimate
// the progress screen runs on (`planTiming.ts` calibrates from this device's
// recorded generations and falls back to the documented workflow model), shown
// BEFORE the request exists, with the same honesty rules:
//
//   * a history-based figure may say "usually" — it is a measurement;
//   * a model fallback says "estimated" — it is an unmeasured prior, and
//     quoting it as "usually" would be the lie the wait screen used to tell.
// ============================================================================

export default function PlanWaitEstimate({
  kind,
  weeks,
}: {
  kind: PlanGenerationKind;
  weeks: number;
}) {
  const { seconds, source } = useMemo(() => estimatePlanSeconds(kind, weeks), [kind, weeks]);
  const fromHistory = source === "history";

  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
      <Clock size={11} className="mt-0.5 shrink-0" aria-hidden />
      <span data-testid="plan-wait-estimate" data-estimate-source={source}>
        {fromHistory
          ? `Plans this length have usually taken about ${seconds}s to write. One request at a time, and it is refunded automatically if it fails.`
          : `Estimated at about ${seconds}s to write — a first-run figure that sharpens to your device's real timings as plans complete. One request at a time, and it is refunded automatically if it fails.`}
      </span>
    </p>
  );
}
