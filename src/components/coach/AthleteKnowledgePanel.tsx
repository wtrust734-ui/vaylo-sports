import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Loader2, RefreshCw, ShieldCheck, X } from "lucide-react";
import { buildClientDossier } from "@/lib/athleteDossier";
import {
  DOSSIER_EXCLUSIONS,
  buildAgeLabel,
  dossierSections,
  hasSectionContent,
  sectionCounts,
} from "@/lib/athleteMemory";

/**
 * "What the coach knows about you".
 *
 * The dossier is the context every AI feature reads, and the athlete has a
 * right to see it rather than take it on trust. This panel reads the SAME
 * builder the AI call uses (`buildClientDossier`) and the same section
 * definitions (`dossierSections`, `athleteMemory.ts`), so it cannot describe a
 * memory the model does not receive — a hand-written second list is exactly the
 * kind of thing that drifts out of step and starts lying.
 *
 * It is deliberately explicit about the limits too: the excluded list is on the
 * panel rather than only in the privacy policy, because "the AI knows
 * everything about you" is only honest when its boundaries are visible.
 */
const AthleteKnowledgePanel = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const [dossier, setDossier] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDossier(await buildClientDossier());
    } catch (e) {
      // Never render a half-built memory as if it were the whole one.
      setError((e as Error)?.message || "The memory could not be read on this device.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const sections = dossier ? dossierSections(dossier) : [];
  const counts = dossier ? sectionCounts(dossier) : { filled: 0, total: 0 };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/70 backdrop-blur-sm z-[59]"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: document.documentElement.dir === "rtl" ? "-100%" : "100%" }}
            animate={{ x: 0 }}
            exit={{ x: document.documentElement.dir === "rtl" ? "-100%" : "100%" }}
            transition={{ type: "spring", stiffness: 400, damping: 35 }}
            className="fixed end-0 top-0 bottom-0 w-[20rem] max-w-[92vw] bg-card/95 backdrop-blur-xl border-s border-border z-[59] flex flex-col"
          >
            <div className="p-4 border-b border-border pt-[max(1rem,var(--vaylo-inset-top))]">
              <div className="flex items-center justify-between">
                <span className="font-display font-bold text-sm flex items-center gap-2">
                  <Brain size={16} className="text-primary" />
                  What the coach knows
                </span>
                <button onClick={onClose} aria-label="Close">
                  <X size={18} className="text-muted-foreground" />
                </button>
              </div>
              <p className="text-[12px] text-muted-foreground mt-1.5 leading-relaxed">
                {counts.filled} of {counts.total} sections hold something
                {dossier ? ` · built ${buildAgeLabel(dossier.builtAt)}` : ""}
              </p>
              <button
                onClick={() => void load()}
                disabled={loading}
                className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary disabled:opacity-50"
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {loading ? "Reading…" : "Refresh"}
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3 pb-[max(0.75rem,var(--vaylo-inset-bottom))] space-y-1.5">
              {error && (
                <p className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-xl p-3">
                  {error}
                </p>
              )}

              {sections.map((section) => {
                const filled = dossier ? hasSectionContent(dossier, section.key) : false;
                return (
                  <div
                    key={section.key}
                    className={`rounded-xl p-3 border ${
                      filled ? "bg-muted/30 border-border" : "bg-transparent border-dashed border-border/70"
                    }`}
                  >
                    <p className={`text-[11px] uppercase tracking-wider font-semibold ${filled ? "text-primary" : "text-muted-foreground/70"}`}>
                      {section.label}
                    </p>
                    <p className={`text-xs mt-0.5 ${filled ? "text-foreground" : "text-muted-foreground/70"}`}>
                      {section.summary}
                    </p>
                  </div>
                );
              })}

              <div className="rounded-xl border border-border bg-muted/20 p-3 mt-2">
                <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1.5">
                  <ShieldCheck size={12} className="text-emerald-300" />
                  Never included
                </p>
                <ul className="mt-1.5 space-y-1">
                  {DOSSIER_EXCLUSIONS.map((item) => (
                    <li key={item} className="text-[12px] text-muted-foreground leading-relaxed">
                      • {item}
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-[11px] leading-relaxed text-muted-foreground/80 px-1 pt-1">
                This is the context sent to the AI provider when you use a coaching feature, including the
                coach chat. Everything in it is something you logged or entered in this app — nothing is
                inferred and nothing is filled in for you.
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default AthleteKnowledgePanel;
