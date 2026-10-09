// ============================================================================
// COACH DIRECTORY — every person who has signed up to be a coach
// ----------------------------------------------------------------------------
// The roster the product asks for: not a list of programmes, and not only the
// coaches who are verified or who happen to have something on sale — the people
// who signed up, with what they teach and what they are selling.
//
// It reads `coach_roster`, a view with a fixed column list, rather than joining
// creator_profiles and marketplace_listings in the client. Two reasons: payout
// email is deliberately unreadable by clients (the 2026-10-06 audit migration
// withdrew the column grant), and "how many plans does this coach have" is the
// one number that decides whether a visitor opens a card at all — reading it in
// the client would mean one query per coach on the screen.
//
// The empty state is the honest one. The marketplace ships with zero coaches on
// purpose (see the flag's note in src/config/featureFlags.ts): a directory of
// invented people would be worse than a directory that says it is new, and this
// component is written so that "nobody yet" is a normal state to render rather
// than a failure to hide.
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { BadgeCheck, Search, UserRound, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fetchCoachRoster, openCoachSignup, type CoachRosterEntry } from "@/lib/coachMarketplace";
import { COACH_COMMISSION_PERCENT, formatMinorUnits } from "@/config/coachMarketplace";

const joined = (iso: string | null): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
};

function CoachCard({
  coach,
  selected,
  onSelect,
}: {
  coach: CoachRosterEntry;
  selected: boolean;
  onSelect?: (userId: string) => void;
}) {
  const since = joined(coach.coach_since);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-2xl border bg-card p-5 ${selected ? "border-primary/60" : "border-border"}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-electric-purple to-energy font-bold text-white">
          {(coach.display_name || "C").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 font-semibold">
            <span className="truncate">{coach.display_name || "Coach"}</span>
            {coach.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-energy" aria-label="Verified coach" />}
          </p>
          <p className="text-[12px] text-muted-foreground">
            {since ? `Coach since ${since}` : "New coach"}
          </p>
        </div>
      </div>

      {coach.bio && <p className="mt-3 line-clamp-3 text-xs text-muted-foreground">{coach.bio}</p>}

      {coach.specialties && coach.specialties.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {coach.specialties.slice(0, 4).map((s) => (
            <span key={s} className="rounded-full bg-muted px-2 py-0.5 text-[12px] text-muted-foreground">
              {s}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-[12px] text-muted-foreground">
          {/* "no plans yet" rather than a zero, because a zero reads as a score. */}
          {coach.listing_count > 0 ? (
            <>
              {coach.listing_count} {coach.listing_count === 1 ? "plan" : "plans"}
              {coach.lowest_net_cents != null && (
                <> · from {formatMinorUnits(coach.lowest_net_cents, "GBP")}</>
              )}
            </>
          ) : (
            "No plans published yet"
          )}
        </div>
        {onSelect && (
          <Button
            size="sm"
            variant={selected ? "default" : "outline"}
            disabled={coach.listing_count === 0}
            onClick={() => onSelect(selected ? "" : coach.user_id)}
          >
            {selected ? "Showing" : "View plans"}
          </Button>
        )}
      </div>
    </motion.div>
  );
}

export default function CoachDirectory({
  onSelect,
  selectedId,
}: {
  /** When given, a card can filter the plans list rather than navigate. */
  onSelect?: (userId: string) => void;
  selectedId?: string;
}) {
  const [coaches, setCoaches] = useState<CoachRosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      const rows = await fetchCoachRoster();
      if (!live) return;
      setCoaches(rows);
      setLoading(false);
    })();
    return () => {
      live = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return coaches;
    const needle = query.trim().toLowerCase();
    return coaches.filter((c) =>
      [c.display_name, c.bio, ...(c.specialties ?? [])]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [coaches, query]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-display text-sm font-bold">
            <Users size={16} className="text-primary" />
            Coaches
          </h3>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Everyone who has signed up to coach on Vaylo Sports. Coaches set their own prices; the
            buyer pays that price plus Vaylo's {COACH_COMMISSION_PERCENT}% fee, which is shown before
            you buy.
          </p>
        </div>
      </div>

      {coaches.length > 6 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search coaches by name or specialty…"
            className="h-11 pl-9"
          />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading coaches…</p>
      ) : coaches.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <UserRound className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No coaches have joined yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            This is a new marketplace, and we would rather show you an empty list than a list of
            people we have not signed up. Coach accounts are created on the website, and a coach
            publishes their own plans from the app.
          </p>
          <Button className="mt-4" variant="outline" onClick={() => void openCoachSignup()}>
            Create a coach account
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No coach matches “{query.trim()}”.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {filtered.map((coach) => (
            <CoachCard
              key={coach.user_id}
              coach={coach}
              selected={selectedId === coach.user_id}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}
