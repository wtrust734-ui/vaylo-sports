import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { LESSONS, categoryFor, difficultyFor, typeFor, type Lesson } from "@/lib/learningContent";
import {
  buildVisibleLessons,
  countLessonsByGoal,
  getLearningStats,
  getLessonsByGoal,
  getPopularLessons,
  getRecommendations,
  getSearchSuggestions,
  type ProgressRecord,
} from "@/lib/learningEngine";
import { CategoryGrid, SportSelector, buildCategoryCounts } from "@/components/learning/SportSelector";
import { SearchBar } from "@/components/learning/SearchBar";
import { GoalGrid } from "@/components/learning/GoalGrid";
import { FilterSheet, DEFAULT_FILTERS, type LearningFilters } from "@/components/learning/FilterSheet";
import { ProgressPanel } from "@/components/learning/ProgressPanel";
import { CompactCard, ContinueCard, FeaturedCard, LessonRow } from "@/components/learning/LessonCard";

const PageSection = ({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) => (
  <section className="mx-auto mt-10 max-w-6xl px-4 sm:px-6">
    <div className="mb-4">
      <h2 className="font-display text-2xl font-bold">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
    {children}
  </section>
);

const LESSONS_BY_ID = new Map(LESSONS.map((lesson) => [lesson.id, lesson]));

export default function Learning() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const [progress, setProgress] = useState<ProgressRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [sport, setSport] = useState("All Sports");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<LearningFilters>(DEFAULT_FILTERS);
  const [goal, setGoal] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("vaylo:learning:sport");
    if (stored) setSport(stored);
  }, []);

  useEffect(() => {
    localStorage.setItem("vaylo:learning:sport", sport);
  }, [sport]);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    const { data } = await supabase.from("learning_progress").select("*").eq("user_id", user.id);
    setProgress((data || []) as ProgressRecord[]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const progressByLesson = useMemo(
    () => Object.fromEntries(progress.map((record) => [record.lesson_id, record])) as Record<string, ProgressRecord>,
    [progress],
  );

  const suggestions = useMemo(() => getSearchSuggestions(query), [query]);

  const visibleLessons = useMemo(
    () => buildVisibleLessons({ sport, query, filters, progress: progressByLesson }),
    [sport, query, filters, progressByLesson],
  );

  const categoryCounts = useMemo(() => buildCategoryCounts(), []);

  const goalLessonCount = useMemo(() => (goal ? countLessonsByGoal(goal) : 0), [goal]);
  const goalLessons = useMemo(() => (goal ? getLessonsByGoal(goal, 3) : []), [goal]);

  const profileSport = profile?.sport ?? null;
  const recommendations = useMemo(
    () =>
      profile
        ? getRecommendations(
            { sport: profileSport, goals: profile?.goals ?? [], experienceLevel: profile?.experience_level ?? null },
            progress,
            3,
          )
        : [],
    [profile, profileSport, progress],
  );

  const featured = useMemo(
    () => buildVisibleLessons({ sport, query: "", filters: DEFAULT_FILTERS, progress: progressByLesson }).slice(0, 3),
    [sport, progressByLesson],
  );
  const popular = useMemo(() => {
    const excluded = new Set(featured.map((lesson) => lesson.id));
    return getPopularLessons(8, excluded);
  }, [featured]);
  const quickLearn = useMemo(() => LESSONS.filter((lesson) => typeFor(lesson) === "Quick Learn").slice(0, 6), []);
  const stats = useMemo(() => getLearningStats(progress), [progress]);

  const viewLesson = useCallback(
    (lesson: Lesson) => {
      navigate(`/learning/${lesson.id}`);
    },
    [navigate],
  );

  const toggleSaved = useCallback(
    async (lesson: Lesson, event: React.MouseEvent) => {
      event.stopPropagation();
      if (!user) return;
      const existing = progressByLesson[lesson.id];
      const next = !existing?.saved;
      const { error } = await supabase.from("learning_progress").upsert(
        {
          user_id: user.id,
          lesson_id: lesson.id,
          category: categoryFor(lesson),
          completed: existing?.completed ?? false,
          mastery_level: existing?.mastery_level ?? 0,
          quiz_score: existing?.quiz_score ?? null,
          completed_at: existing?.completed_at ?? null,
          saved: next,
          viewed_at: existing?.viewed_at ?? new Date().toISOString(),
        },
        { onConflict: "user_id,lesson_id" },
      );
      if (error) toast.error(`Couldn't update your saved lessons: ${error.message}`);
      void load();
    },
    [user, progressByLesson, load],
  );

  const openLesson = useCallback(
    (lesson: Lesson) => {
      if (user) {
        void supabase
          .from("learning_progress")
          .upsert(
            {
              user_id: user.id,
              lesson_id: lesson.id,
              category: categoryFor(lesson),
              completed: progressByLesson[lesson.id]?.completed ?? false,
              mastery_level: progressByLesson[lesson.id]?.mastery_level ?? 0,
              quiz_score: progressByLesson[lesson.id]?.quiz_score ?? null,
              completed_at: progressByLesson[lesson.id]?.completed_at ?? null,
              saved: progressByLesson[lesson.id]?.saved ?? false,
              viewed_at: new Date().toISOString(),
            },
            { onConflict: "user_id,lesson_id" },
          )
          // Progress tracking is best-effort: surface the failure, still open the lesson.
          .then(({ error }) => {
            if (error) toast.error(`Couldn't save your progress: ${error.message}`);
            void load();
          });
      }
      viewLesson(lesson);
    },
    [user, progressByLesson, viewLesson, load],
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="animate-spin text-electric-purple" />
      </div>
    );
  }

  const isFiltering = query.trim().length > 0 || sport !== "All Sports" || filters.category !== "All" || filters.difficulty !== "All" || filters.time !== "All" || filters.type !== "All";

  return (
    <main className="min-h-screen overflow-hidden pb-28 pt-20">
      {/* 1 — Hero */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-[2rem] border border-electric-purple/25 bg-gradient-to-br from-electric-purple/20 via-card to-navy-deep p-6 shadow-card sm:p-9">
          <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-electric-purple/20 blur-3xl" />
          <p className="relative text-[11px] font-bold tracking-[0.24em] text-electric-purple">LEARNING</p>
          <h1 className="relative mt-3 max-w-xl font-display text-4xl font-black tracking-tight sm:text-5xl">
            Get Better at <span className="text-gradient-electric">Your Sport.</span>
          </h1>
          <p className="relative mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Expert-backed knowledge, techniques and training guidance built to help you understand your sport and perform better.
          </p>
          <div className="relative mt-6">
            <SearchBar
              query={query}
              onQueryChange={setQuery}
              suggestions={suggestions}
              lessonsById={LESSONS_BY_ID}
              onOpenLesson={openLesson}
            />
          </div>
          <button
            onClick={() => setFiltersOpen(true)}
            className="relative mt-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <span className="rounded-lg border border-border bg-card px-3 py-1.5">Filters{isFiltering ? " •" : ""}</span>
            {isFiltering && (
              <span className="text-electric-purple">
                {visibleLessons.length} match{visibleLessons.length === 1 ? "" : "es"}
              </span>
            )}
          </button>
        </div>
      </section>

      {/* 2 — Sport selector */}
      <PageSection title="Choose your sport" subtitle="Your learning feed adapts as the library grows.">
        <SportSelector selected={sport} onSelect={setSport} />
      </PageSection>

      {/* 3 — Categories */}
      <PageSection title="Explore a topic" subtitle="Build the knowledge behind better decisions.">
        <CategoryGrid
          counts={categoryCounts}
          onSelect={(categoryId) => {
            setFilters((current) => ({ ...current, category: categoryId }));
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      </PageSection>

      {/* 4 — Featured */}
      <PageSection title="Featured learning" subtitle="High-value knowledge, built for the moments that matter.">
        <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          {featured.map((lesson, index) => (
            <FeaturedCard
              key={lesson.id}
              lesson={lesson}
              index={index}
              saved={!!progressByLesson[lesson.id]?.saved}
              onOpen={openLesson}
              onToggleSave={toggleSaved}
            />
          ))}
        </div>
      </PageSection>

      {/* 5 — Popular */}
      <PageSection title="Popular right now" subtitle="What athletes are reading and saving this week.">
        <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          {popular.map((lesson) => (
            <CompactCard
              key={lesson.id}
              lesson={lesson}
              saved={!!progressByLesson[lesson.id]?.saved}
              onOpen={openLesson}
              onToggleSave={toggleSaved}
            />
          ))}
        </div>
      </PageSection>

      {/* 6 — Learn by goal */}
      <PageSection title="Learn by goal" subtitle="Start with what you want to improve, not a syllabus.">
        <GoalGrid selected={goal} onSelect={setGoal} />
        {goal && (
          <div className="mt-4 rounded-2xl border border-electric-purple/30 bg-electric-purple/5 p-4">
            <p className="text-sm font-bold">
              Start here — {goalLessonCount} piece{goalLessonCount === 1 ? "" : "s"} matched
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {goalLessons.map((lesson) => (
                <ContinueCard key={lesson.id} lesson={lesson} onOpen={openLesson} />
              ))}
            </div>
          </div>
        )}
      </PageSection>

      {/* 7 — Personalised */}
      {profileSport && recommendations.length > 0 && (
        <PageSection title="Recommended for you" subtitle="Based on your sport, goals and what you've been reading.">
          <div className="grid gap-3 md:grid-cols-3">
            {recommendations.map(({ lesson, reason }) => (
              <article
                key={lesson.id}
                onClick={() => openLesson(lesson)}
                className="press-card cursor-pointer rounded-2xl border border-border bg-card/70 p-4 hover:border-electric-purple/45"
              >
                <p className="text-[10px] font-bold uppercase tracking-wider text-electric-purple">{reason}</p>
                <h3 className="mt-2 font-bold leading-snug">{lesson.title}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{lesson.summary}</p>
                <p className="mt-3 text-[11px] font-medium text-muted-foreground">
                  {categoryFor(lesson)} · {lesson.duration} read · {difficultyFor(lesson)}
                </p>
              </article>
            ))}
          </div>
        </PageSection>
      )}

      {/* 8 — Quick Learn */}
      <PageSection title="Quick Learn" subtitle="Useful sport science in under 90 seconds.">
        <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          {quickLearn.map((lesson) => (
            <CompactCard
              key={lesson.id}
              lesson={lesson}
              saved={!!progressByLesson[lesson.id]?.saved}
              onOpen={openLesson}
              onToggleSave={toggleSaved}
            />
          ))}
        </div>
      </PageSection>

      {/* 9 — Progress */}
      <PageSection title="Your learning" subtitle="A quiet record of what you are building.">
        <ProgressPanel stats={stats} />
      </PageSection>

      {/* 10 — Library / results */}
      <PageSection
        title={isFiltering ? "Search results" : "Keep exploring"}
        subtitle={`${visibleLessons.length} piece${visibleLessons.length === 1 ? "" : "s"} of learning content`}
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visibleLessons.map((lesson) => (
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              saved={!!progressByLesson[lesson.id]?.saved}
              completed={!!progressByLesson[lesson.id]?.completed}
              onOpen={openLesson}
              onToggleSave={toggleSaved}
            />
          ))}
        </div>
      </PageSection>

      <FilterSheet open={filtersOpen} filters={filters} onClose={() => setFiltersOpen(false)} onChange={setFilters} />
    </main>
  );
}
