import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Bookmark, Check, CheckCircle2, Clock3, Share2, ThumbsDown, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { LESSONS, categoryFor, difficultyFor, typeFor } from "@/lib/learningContent";
import { getRelated } from "@/lib/learningEngine";
import { publicAppUrl, shareContent } from "@/lib/share";
import { ContinueCard } from "@/components/learning/LessonCard";

type FeedbackRating = "helpful" | "not_helpful";

interface ProgressRow {
  saved: boolean;
  completed: boolean;
  completed_at: string | null;
  mastery_level: number;
  quiz_score: number | null;
  viewed_at: string | null;
}

export default function LearningArticle() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const lesson = useMemo(() => LESSONS.find((item) => item.id === lessonId) ?? null, [lessonId]);
  const related = useMemo(() => (lesson ? getRelated(lesson, 3) : []), [lesson]);

  const [row, setRow] = useState<ProgressRow | null>(null);
  const [saved, setSaved] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [feedback, setFeedback] = useState<FeedbackRating | null>(null);

  // Load existing progress, then record this view.
  useEffect(() => {
    if (!user || !lesson) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("learning_progress")
        .select("*")
        .eq("user_id", user.id)
        .eq("lesson_id", lesson.id)
        .maybeSingle();
      if (cancelled) return;
      setRow((data ?? null) as ProgressRow | null);
      if (data) {
        setSaved(data.saved);
        setCompleted(data.completed);
      }
      // View tracking is background work — log failures, don't interrupt reading.
      const { error: viewError } = await supabase
        .from("learning_progress")
        .upsert(
          {
            user_id: user.id,
            lesson_id: lesson.id,
            category: categoryFor(lesson),
            completed: data?.completed ?? false,
            mastery_level: data?.mastery_level ?? 0,
            quiz_score: data?.quiz_score ?? null,
            completed_at: data?.completed_at ?? null,
            saved: data?.saved ?? false,
            viewed_at: new Date().toISOString(),
          },
          { onConflict: "user_id,lesson_id" },
        );
      if (viewError) console.error("lesson view tracking failed:", viewError.message);
      const { data: feedbackRow } = await supabase
        .from("learning_feedback")
        .select("rating")
        .eq("user_id", user.id)
        .eq("lesson_id", lesson.id)
        .maybeSingle();
      if (!cancelled && feedbackRow) setFeedback(feedbackRow.rating as FeedbackRating);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, lesson]);

  const quizTotal = lesson?.quiz.length ?? 0;
  const answeredCount = Object.keys(answers).length;
  const correctCount = useMemo(
    () => (lesson ? lesson.quiz.reduce((total, question, index) => total + (answers[index] === question.correct ? 1 : 0), 0) : 0),
    [answers, lesson],
  );
  const quizDone = quizTotal > 0 && answeredCount === quizTotal;

  // Completing the knowledge check marks the lesson as complete.
  useEffect(() => {
    if (!user || !lesson || !quizDone || completed) return;
    const score = Math.round((correctCount / quizTotal) * 100);
    setCompleted(true);
    void supabase
      .from("learning_progress")
      .upsert(
        {
          user_id: user.id,
          lesson_id: lesson.id,
          category: categoryFor(lesson),
          completed: true,
          mastery_level: score,
          quiz_score: score,
          completed_at: new Date().toISOString(),
          saved: row?.saved ?? false,
          viewed_at: new Date().toISOString(),
        },
        { onConflict: "user_id,lesson_id" },
      )
      .then(({ error }) => {
        if (error) toast.error(`Couldn't save your quiz result: ${error.message}`);
      });
  }, [quizDone, completed, correctCount, quizTotal, user, lesson, row?.saved]);

  const toggleSave = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();
      if (!user) {
        toast.info("Sign in to save lessons");
        return;
      }
      if (!lesson) return;
      const next = !saved;
      setSaved(next); // optimistic — rolled back below if the write fails
      const { error } = await supabase
        .from("learning_progress")
        .upsert(
          {
            user_id: user.id,
            lesson_id: lesson.id,
            category: categoryFor(lesson),
            completed,
            mastery_level: row?.mastery_level ?? 0,
            quiz_score: row?.quiz_score ?? null,
            completed_at: row?.completed_at ?? null,
            saved: next,
            viewed_at: new Date().toISOString(),
          },
          { onConflict: "user_id,lesson_id" },
        );
      if (error) {
        setSaved(!next);
        toast.error(`Couldn't save that lesson: ${error.message}`);
        return;
      }
      toast.success(next ? "Saved to your learning" : "Removed from saved");
    },
    [user, lesson, saved, completed, row],
  );

  const share = useCallback(async () => {
    if (!lesson) return;
    // publicAppUrl keeps the link shareable inside a native shell, where the
    // page origin is capacitor://localhost.
    const result = await shareContent({
      title: lesson.title,
      text: lesson.summary,
      url: publicAppUrl(`/learning/${lesson.id}`),
    });
    if (result === "copied") toast.success("Link copied");
    if (result === "unsupported") toast.error("Sharing isn't available on this device");
  }, [lesson]);

  const sendFeedback = useCallback(
    async (rating: FeedbackRating) => {
      if (!user || !lesson) return;
      setFeedback(rating);
      const { error } = await supabase
        .from("learning_feedback")
        .upsert({ user_id: user.id, lesson_id: lesson.id, rating }, { onConflict: "user_id,lesson_id" });
      if (error) { toast.error(`Couldn't save your feedback: ${error.message}`); return; }
      toast.success("Thanks — noted.");
    },
    [user, lesson],
  );

  if (!lesson) {
    return (
      <main className="min-h-screen pb-28 pt-20">
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <p className="font-display text-2xl font-bold">Lesson not found</p>
          <p className="mt-2 text-sm text-muted-foreground">It may have been renamed or removed.</p>
          <button
            onClick={() => navigate("/learning")}
            className="mt-6 rounded-xl bg-electric-purple px-4 py-2.5 text-sm font-bold text-white"
          >
            Back to Learning
          </button>
        </div>
      </main>
    );
  }

  const answer = (questionIndex: number, optionIndex: number) => {
    setAnswers((current) => (current[questionIndex] !== undefined ? current : { ...current, [questionIndex]: optionIndex }));
  };

  const paragraphs = lesson.body.split("\n\n");

  return (
    <main className="min-h-screen pb-28 pt-20">
      <article className="mx-auto max-w-2xl px-4 sm:px-6">
        {/* Sticky reader bar */}
        <div className="sticky top-20 z-20 -mx-4 mb-8 flex items-center justify-between gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          <button
            onClick={() => navigate("/learning")}
            className="icon-tap flex items-center gap-1.5 rounded-xl px-2 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={17} /> Back
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleSave}
              aria-label={saved ? "Remove from saved" : "Save lesson"}
              className="icon-tap grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-muted"
            >
              <Bookmark size={18} className={saved ? "fill-electric-purple text-electric-purple" : ""} />
            </button>
            <button onClick={share} aria-label="Share lesson" className="icon-tap grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-muted">
              <Share2 size={18} />
            </button>
          </div>
        </div>

        {/* Header */}
        <motion.header initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-electric-purple/15 px-2.5 py-1 text-[10px] font-bold tracking-wider text-electric-purple">
              {(lesson.sports?.[0] || "All Sports").toUpperCase()} · {categoryFor(lesson).toUpperCase()}
            </span>
            {completed && (
              <span className="flex items-center gap-1 rounded-full bg-electric-purple/10 px-2.5 py-1 text-[10px] font-bold text-electric-purple">
                <CheckCircle2 size={12} /> Completed
              </span>
            )}
          </div>
          <h1 className="mt-4 font-display text-4xl font-black leading-tight sm:text-5xl">{lesson.title}</h1>
          <p className="mt-4 text-lg leading-7 text-muted-foreground">{lesson.summary}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <span className="flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">
              <Clock3 size={13} /> {lesson.duration} read
            </span>
            <span className="rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">{difficultyFor(lesson)}</span>
            <span className="rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">{typeFor(lesson)}</span>
          </div>
        </motion.header>

        {/* Body */}
        <div className="mt-10 space-y-5">
          {paragraphs.map((paragraph, index) => {
            const lines = paragraph.split("\n").filter(Boolean);
            const isBullets = lines.length > 1 && lines.every((line) => line.trim().startsWith("•"));
            if (isBullets) {
              return (
                <ul key={index} className="space-y-2.5">
                  {lines.map((line, lineIndex) => (
                    <li key={lineIndex} className="flex gap-2.5 text-[15px] leading-7 text-foreground/90">
                      <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-electric-purple" />
                      <span>{line.replace(/^•\s*/, "")}</span>
                    </li>
                  ))}
                </ul>
              );
            }
            return (
              <p key={index} className="text-[15px] leading-7 text-foreground/90">
                {paragraph}
              </p>
            );
          })}
        </div>

        {/* Key takeaways */}
        {lesson.takeaways && lesson.takeaways.length > 0 && (
          <section className="mt-10 rounded-3xl border border-electric-purple/30 bg-electric-purple/5 p-5 sm:p-6">
            <h2 className="font-display text-xl font-bold">Key takeaways</h2>
            <ul className="mt-4 space-y-3">
              {lesson.takeaways.map((takeaway) => (
                <li key={takeaway} className="flex gap-2.5 text-sm leading-6 text-foreground/90">
                  <Check size={16} className="mt-1 shrink-0 text-electric-purple" />
                  {takeaway}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Test yourself */}
        {lesson.quiz.length > 0 && (
          <section className="mt-8 rounded-3xl border border-border bg-card p-5 sm:p-6">
            <h2 className="font-display text-xl font-bold">Test yourself</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {quizDone
                ? `You scored ${correctCount}/${quizTotal}.`
                : `${quizTotal} quick questions — finishing them saves your progress.`}
            </p>
            <div className="mt-5 space-y-6">
              {lesson.quiz.map((question, questionIndex) => {
                const chosen = answers[questionIndex];
                return (
                  <div key={question.q}>
                    <p className="text-sm font-bold">
                      {questionIndex + 1}. {question.q}
                    </p>
                    <div className="mt-2.5 grid grid-cols-1 gap-2">
                      {question.options.map((option, optionIndex) => {
                        const isChosen = chosen === optionIndex;
                        const isCorrect = optionIndex === question.correct;
                        const revealed = chosen !== undefined;
                        return (
                          <button
                            key={option}
                            onClick={() => answer(questionIndex, optionIndex)}
                            disabled={revealed}
                            className={`rounded-xl border px-4 py-3 text-start text-sm font-medium transition-colors ${
                              revealed && isCorrect
                                ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                                : revealed && isChosen
                                  ? "border-red-500/60 bg-red-500/10 text-red-300"
                                  : "border-border bg-background hover:border-electric-purple/50 hover:bg-electric-purple/5"
                            }`}
                          >
                            {option}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Feedback */}
        <section className="mt-8 rounded-3xl border border-border bg-card p-5 sm:p-6">
          <h2 className="font-display text-xl font-bold">What did you think?</h2>
          {feedback ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 size={16} className="text-electric-purple" />
              Thanks — your feedback helps shape the library.
            </p>
          ) : (
            <div className="mt-4 flex gap-3">
              <button
                onClick={() => void sendFeedback("helpful")}
                className="press flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-3 text-sm font-semibold hover:border-electric-purple/50"
              >
                <ThumbsUp size={15} className="text-electric-purple" /> Helpful
              </button>
              <button
                onClick={() => void sendFeedback("not_helpful")}
                className="press flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-3 text-sm font-semibold hover:border-electric-purple/50"
              >
                <ThumbsDown size={15} className="text-muted-foreground" /> Not for me
              </button>
            </div>
          )}
        </section>

        {/* Continue learning */}
        {related.length > 0 && (
          <section className="mt-12">
            <div className="mb-4">
              <h2 className="font-display text-2xl font-bold">Continue learning</h2>
            </div>
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">
              {related.map((item) => (
                <ContinueCard key={item.id} lesson={item} onOpen={(next) => navigate(`/learning/${next.id}`)} />
              ))}
            </div>
          </section>
        )}
      </article>
    </main>
  );
}
