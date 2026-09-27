import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Clock3, Search, X } from "lucide-react";
import { TRENDING_SEARCHES, categoryFor, type Lesson } from "@/lib/learningContent";
import { clearRecentSearches, getRecentSearches, saveRecentSearch } from "@/lib/learningEngine";

interface SearchBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  suggestions: Array<{ label: string; lessonId: string }>;
  lessonsById: Map<string, Lesson>;
  onOpenLesson: (lesson: Lesson) => void;
}

/** Hero search with animated suggestion dropdown, recent searches and smart starters. */
export function SearchBar({ query, onQueryChange, suggestions, lessonsById, onOpenLesson }: SearchBarProps) {
  const [focused, setFocused] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setRecents(getRecentSearches());
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setFocused(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const dropdownOpen = focused && (query.trim().length > 0 ? suggestions.length > 0 : recents.length > 0);

  const choose = (label: string, lessonId?: string) => {
    saveRecentSearch(label);
    setRecents(getRecentSearches());
    if (lessonId) {
      const lesson = lessonsById.get(lessonId);
      if (lesson) {
        onOpenLesson(lesson);
        setFocused(false);
        return;
      }
    }
    onQueryChange(label);
    setFocused(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <motion.div
        animate={{
          borderColor: focused ? "rgba(168,85,247,0.7)" : "rgba(255,255,255,0.08)",
          boxShadow: focused ? "0 0 0 4px rgba(168,85,247,0.12)" : "0 0 0 0px rgba(168,85,247,0)",
        }}
        transition={{ duration: 0.2 }}
        className="flex items-center gap-2 rounded-2xl border bg-background/80 px-4 py-3 shadow-card"
      >
        <Search size={19} className="shrink-0 text-electric-purple" />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onFocus={() => setFocused(true)}
          placeholder="Search anything..."
          aria-label="Search learning content"
          enterKeyHint="search"
          className="h-9 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        {query && (
          <button onClick={() => onQueryChange("")} aria-label="Clear search" className="icon-tap grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-muted">
            <X size={16} />
          </button>
        )}
      </motion.div>

      <AnimatePresence>
        {dropdownOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-border bg-card shadow-card"
          >
            {!query.trim() && recents.length > 0 && (
              <div className="p-2">
                <div className="flex items-center justify-between px-2 pb-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Recent searches</p>
                  <button onClick={() => { clearRecentSearches(); setRecents([]); }} className="text-[10px] font-semibold text-electric-purple">Clear</button>
                </div>
                {recents.map((recent) => (
                  <button key={recent} onClick={() => choose(recent)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-start text-sm hover:bg-muted/70">
                    <Clock3 size={13} className="shrink-0 text-muted-foreground" /> {recent}
                  </button>
                ))}
              </div>
            )}
            {query.trim() && (
              <div className="p-2">
                {suggestions.map((suggestion) => {
                  const lesson = lessonsById.get(suggestion.lessonId);
                  return (
                    <button key={suggestion.label} onClick={() => choose(suggestion.label, suggestion.lessonId)} className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-start hover:bg-muted/70">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{suggestion.label}</span>
                        {lesson && <span className="text-xs text-muted-foreground">{categoryFor(lesson)} · {lesson.duration}</span>}
                      </span>
                      <ChevronRight size={15} className="shrink-0 text-electric-purple" />
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {!focused && !query && (
        <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1">
          {TRENDING_SEARCHES.map((term) => (
            <button
              key={term}
              onClick={() => choose(term)}
              className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-electric-purple/40 hover:text-foreground"
            >
              {term}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
