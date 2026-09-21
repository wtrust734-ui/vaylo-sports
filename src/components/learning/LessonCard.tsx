import { motion } from "framer-motion";
import { ArrowRight, Bookmark, Check, Clock3 } from "lucide-react";
import { categoryFor, difficultyFor, typeFor, type Lesson } from "@/lib/learningContent";

interface BaseProps {
  lesson: Lesson;
  saved?: boolean;
  completed?: boolean;
  onOpen: (lesson: Lesson) => void;
  onToggleSave: (lesson: Lesson, event: React.MouseEvent) => void;
}

const metaText = (lesson: Lesson) =>
  `${categoryFor(lesson)} · ${lesson.duration} read · ${difficultyFor(lesson)}`;

const SaveButton = ({ saved, onClick, size = 17 }: { saved?: boolean; onClick: (event: React.MouseEvent) => void; size?: number }) => (
  <button
    onClick={onClick}
    aria-label={saved ? "Remove from saved" : "Save lesson"}
    className="icon-tap grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-white/10 active:bg-white/20"
  >
    <Bookmark size={size} className={saved ? "fill-electric-purple text-electric-purple" : ""} />
  </button>
);

/** Large promo card for the Featured section. */
export function FeaturedCard({ lesson, saved, onOpen, onToggleSave, index = 0 }: BaseProps & { index?: number }) {
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ delay: index * 0.06, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onOpen(lesson)}
      className="press relative min-w-[290px] max-w-[380px] flex-1 cursor-pointer overflow-hidden rounded-3xl border border-electric-purple/25 bg-gradient-to-br from-navy via-card to-electric-purple/15 p-5 shadow-card sm:min-w-[330px]"
    >
      <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-electric-purple/25 blur-2xl" />
      <div className="relative flex items-start justify-between gap-2">
        <span className="rounded-full bg-electric-purple/15 px-2.5 py-1 text-[10px] font-bold tracking-wider text-electric-purple">
          {(lesson.sports?.[0] || "ALL SPORTS").toUpperCase()} · {categoryFor(lesson).toUpperCase()}
        </span>
        <SaveButton saved={saved} onClick={(event) => onToggleSave(lesson, event)} />
      </div>
      <h3 className="relative mt-12 font-display text-2xl font-bold leading-tight">{lesson.title}</h3>
      <p className="relative mt-2 line-clamp-2 text-sm text-muted-foreground">{lesson.summary}</p>
      <div className="relative mt-4 flex items-center justify-between">
        <p className="text-[11px] font-medium text-muted-foreground">{metaText(lesson)}</p>
        <span className="flex items-center gap-1 rounded-xl bg-white px-3 py-2 text-xs font-bold text-navy-deep">
          Read <ArrowRight className="inline" size={13} />
        </span>
      </div>
    </motion.article>
  );
}

/** Compact card for horizontal scrollers (Popular, Quick Learn). */
export function CompactCard({ lesson, saved, onOpen, onToggleSave }: BaseProps) {
  return (
    <article
      onClick={() => onOpen(lesson)}
      className="press-card w-[210px] shrink-0 cursor-pointer rounded-2xl border border-border bg-card p-4 hover:border-electric-purple/40"
    >
      <div className="flex justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-electric-purple">{typeFor(lesson)}</span>
        <SaveButton saved={saved} onClick={(event) => onToggleSave(lesson, event)} size={16} />
      </div>
      <h3 className="mt-4 line-clamp-3 font-bold leading-snug">{lesson.title}</h3>
      <p className="mt-2 line-clamp-2 text-xs leading-4 text-muted-foreground">{lesson.summary}</p>
      <div className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground">
        <Clock3 size={12} /> {lesson.duration}
      </div>
    </article>
  );
}

/** Full-width row for result grids and recommendations. */
export function LessonRow({ lesson, saved, completed, onOpen, onToggleSave }: BaseProps) {
  return (
    <article
      onClick={() => onOpen(lesson)}
      className="press-card group cursor-pointer rounded-2xl border border-border bg-card/70 p-4 hover:border-electric-purple/45"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[10px] font-bold uppercase tracking-wider text-electric-purple">
            {categoryFor(lesson)} · {typeFor(lesson)}
          </span>
          <h3 className="mt-2 font-bold leading-snug group-hover:text-electric-purple">{lesson.title}</h3>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{lesson.summary}</p>
          <p className="mt-3 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
            {metaText(lesson)}
            {completed && (
              <span className="inline-flex items-center gap-1 rounded-full bg-electric-purple/10 px-2 py-0.5 font-semibold text-electric-purple">
                <Check size={11} /> Completed
              </span>
            )}
          </p>
        </div>
        <SaveButton saved={saved} onClick={(event) => onToggleSave(lesson, event)} />
      </div>
    </article>
  );
}

/** Slim row used for "Continue learning" and goal results. */
export function ContinueCard({ lesson, onOpen }: { lesson: Lesson; onOpen: (lesson: Lesson) => void }) {
  return (
    <button
      onClick={() => onOpen(lesson)}
      className="press-card rounded-2xl border border-border bg-card p-4 text-left hover:border-electric-purple/40"
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-electric-purple">{categoryFor(lesson)}</p>
      <p className="mt-2 text-sm font-bold leading-snug">{lesson.title}</p>
      <p className="mt-2 text-xs text-muted-foreground">{lesson.duration} read · {difficultyFor(lesson)}</p>
    </button>
  );
}
