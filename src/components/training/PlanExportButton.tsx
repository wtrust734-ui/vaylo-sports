import { useState } from "react";
import { Calendar, HardDriveDownload, FileText } from "lucide-react";
import {
  buildPlanExport,
  planExportFilename,
  type PlanExportFormat,
} from "@/lib/planExport";
import type { DatedSession } from "@/lib/planSchedule";

/**
 * Export control for a generated plan. Renders a small row of two buttons
 * (calendar file / GPS file) and hands a completed string to the browser's
 * download mechanism — no upload, no edge function, no network: export must
 * work offline the same way reading the plan does.
 *
 * Sessions come in already dated (planSchedule.flattenPlan), so positioning
 * math lives in one place only — this component never recomputes a Monday.
 */
const PlanExportButton = ({ sessions, planTitle }: { sessions: readonly DatedSession[]; planTitle: string }) => {
  const [busy, setBusy] = useState(false);
  if (sessions.length === 0) return null;

  const exportAs = (format: PlanExportFormat) => {
    setBusy(true);
    try {
      const text = buildPlanExport(sessions, planTitle, format);
      const blob = new Blob([text], {
        type: format === "ics" ? "text/calendar" : "application/gpx+xml",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = planExportFilename(format);
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex gap-2" role="group" aria-label="Export this plan">
      <button
        type="button"
        disabled={busy}
        onClick={() => exportAs("ics")}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        title="Add the plan to your calendar (.ics)"
      >
        {busy ? <HardDriveDownload size={13} /> : <Calendar size={13} />} Calendar
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => exportAs("gpx")}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12px] font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        title="Export for your GPS device (.gpx)"
      >
        {busy ? <HardDriveDownload size={13} /> : <FileText size={13} />} GPS
      </button>
    </div>
  );
};

export default PlanExportButton;
