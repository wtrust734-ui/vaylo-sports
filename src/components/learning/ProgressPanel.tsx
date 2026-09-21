import { motion } from "framer-motion";
import { Flame } from "lucide-react";
import type { LearningStats } from "@/lib/learningEngine";

const StatTile = ({ label, value, suffix }: { label: string; value: number; suffix: string }) => (
  <div className="rounded-2xl border border-border bg-card p-4">
    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="mt-1.5 font-display text-3xl font-bold text-gradient-electric">{value}</p>
    <p className="text-xs text-muted-foreground">{suffix}</p>
  </div>
);

/** Lightweight progress panel — encouraging, not gamified. */
export function ProgressPanel({ stats }: { stats: LearningStats }) {
  const activeCategories = stats.categoryProgress.filter((entry) => entry.completed > 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Completed" value={stats.completed} suffix="articles" />
        <StatTile label="Topics explored" value={stats.topicsExplored} suffix="topics" />
        <StatTile label="Saved" value={stats.saved} suffix="to revisit" />
        <StatTile label="Library" value={stats.totalLessons} suffix="lessons" />
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <span className={`grid h-10 w-10 place-items-center rounded-xl ${stats.streak > 0 ? "bg-electric-purple/15 text-electric-purple" : "bg-muted text-muted-foreground"}`}>
            <Flame size={18} />
          </span>
          <div>
            <p className="text-sm font-bold">
              {stats.streak > 0 ? `${stats.streak}-day learning streak` : "Start a learning streak"}
            </p>
            <p className="text-xs text-muted-foreground">
              {stats.streak > 0 ? "Read or save something today to keep it going." : "Open one article today — that's all it takes."}
            </p>
          </div>
        </div>
      </div>

      {activeCategories.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Progress by topic</p>
          <div className="mt-3 space-y-3">
            {activeCategories.map((entry) => {
              const percent = Math.round((entry.completed / entry.total) * 100);
              return (
                <div key={entry.category}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold">{entry.category}</span>
                    <span className="text-muted-foreground">{entry.completed}/{entry.total}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${percent}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                      className="h-full rounded-full bg-gradient-electric"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
