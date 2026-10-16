import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Award, Check, ChevronRight, Flame, Gift, Loader2, Sparkles, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentStreak } from "@/lib/recoveryStreak";
import {
  BOX_MILESTONES,
  nextMilestones,
  openedBoxes,
  pendingBoxes,
  markBoxOpened,
  type PendingBox,
} from "@/lib/rewardBoxes";
import { getItem } from "@/lib/avatarCatalog";
import { claimRewardBox, type BoxGrant } from "@/lib/rewardBoxGrant";
import { DEFAULT_LOADOUT, RARITY_META as AVATAR_RARITY } from "@/lib/avatarCatalog";
import AvatarCharacter from "@/components/avatar/AvatarCharacter";

// ============================================================================
// REWARD BOXES PANEL — the surprise-box surface
// ----------------------------------------------------------------------------
// Earned-but-unopened boxes (recovery-streak milestones and qualifying
// referrals) render as rarity-tinted boxes; opening one asks the SERVER for
// the contents (claim_reward_box picks and grants — see
// supabase/migrations/20261015120000_reward_box_grants.sql), then reveals the
// item on the athlete's own avatar so "what does it look like" is answered at
// the moment it matters. See src/lib/rewardBoxes.ts for the economics.
// ============================================================================

const keyOf = (source: string, threshold: number): string => `${source}:${threshold}`;
const boxKeyOf = (b: PendingBox) => keyOf(b.milestone.source, b.milestone.threshold);

export default function RewardBoxesPanel({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [qualifying, setQualifying] = useState<number | null>(null);
  const [ledgerVersion, setLedgerVersion] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ box: PendingBox; grant: BoxGrant } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Avatar-cosmetic ownership, so the server (and the pending list) can prefer
  // items the athlete does not already have.
  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data } = await supabase.from("avatar_items").select("item_id").eq("user_id", user.id);
      setOwned(new Set((data ?? []).map((r: { item_id: string }) => r.item_id)));
    })();
  }, [user]);

  // Qualifying-referral count is a server aggregate; a failure means "unknown",
  // never zero — referral boxes stay hidden rather than invented.
  useEffect(() => {
    if (!user) return;
    void (async () => {
      const { data, error: rpcError } = await supabase.rpc("referral_qualification_count" as never, {
        p_referrer: user.id,
      } as never);
      if (!rpcError) setQualifying(Number(data ?? 0));
    })();
  }, [user]);

  const streak = getCurrentStreak();
  const pending = useMemo(
    () =>
      pendingBoxes(
        { streak: streak.current, qualifyingReferrals: qualifying ?? undefined },
        owned,
      ),
    // ledgerVersion re-runs the memo after a box is opened on this device.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streak.current, qualifying, owned, ledgerVersion],
  );
  const next = useMemo(
    () => nextMilestones({ streak: streak.current, qualifyingReferrals: qualifying ?? undefined }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streak.current, qualifying, ledgerVersion],
  );
  // Re-read on every render after an open: the milestone list below is the
  // awards record, so it must show the box as opened the moment it is.
  const opened = useMemo(() => openedBoxes(), [ledgerVersion]);

  const open = useCallback(
    async (box: PendingBox) => {
      if (opening) return;
      setOpening(boxKeyOf(box));
      setError(null);
      const { grant, error: grantError } = await claimRewardBox(
        box.milestone.source,
        box.milestone.threshold,
      );
      setOpening(null);
      if (grantError || !grant) {
        // Honest failure: the box stays unopened and the reason is shown
        // (undeployed migration, offline, signed out).
        setError(grantError ?? "This box could not be opened right now.");
        return;
      }
      markBoxOpened({
        source: box.milestone.source,
        threshold: box.milestone.threshold,
        itemId: grant.itemId,
        openedOn: new Date().toISOString().slice(0, 10),
      });
      setOwned((s) => new Set(s).add(grant.itemId));
      setLedgerVersion((v) => v + 1);
      setRevealed({ box, grant });
    },
    [opening],
  );

  if (!user) return null;

  return (
    <section aria-label="Surprise boxes" className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <Sparkles size={14} className="text-primary" />
        <h2 className="text-sm font-display font-bold uppercase tracking-wider">Surprise boxes</h2>
        {opened.length > 0 && (
          <span className="ml-auto text-[12px] text-muted-foreground">{opened.length} opened</span>
        )}
      </div>

      {error && (
        <p className="rounded-2xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          {error}
        </p>
      )}

      {pending.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card/60 px-4 py-3 text-[12px] text-muted-foreground">
          {next.length > 0
            ? `No boxes waiting. Next up: ${next[0].label}.`
            : "Every box so far is open. New milestones bring new boxes."}
        </div>
      ) : (
        <div className={`grid gap-2.5 ${compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3"}`}>
          {pending.map((box) => {
            const meta = AVATAR_RARITY[box.milestone.rarity];
            const isOpening = opening === boxKeyOf(box);
            return (
              <motion.button
                key={boxKeyOf(box)}
                type="button"
                onClick={() => void open(box)}
                disabled={opening !== null}
                whileTap={{ scale: 0.97 }}
                className="relative overflow-hidden rounded-2xl border p-3.5 text-start disabled:opacity-70"
                style={{
                  borderColor: `${meta.color}66`,
                  background: `linear-gradient(160deg, ${meta.gradient}, hsl(220 40% 8% / 0.9))`,
                  boxShadow: `0 0 24px ${meta.glow}33`,
                }}
              >
                <div className="flex items-center gap-2">
                  <Gift size={18} className="text-white/90" />
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-black uppercase tracking-wider text-white/90">
                      {box.milestone.label}
                    </p>
                    <p className="text-[11px] text-white/60">{meta.label} box</p>
                  </div>
                  <span className="ml-auto">
                    {isOpening ? (
                      <Loader2 size={15} className="animate-spin text-white/90" />
                    ) : (
                      <ChevronRight size={15} className="text-white/70" />
                    )}
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-white/70">Tap to open</p>
              </motion.button>
            );
          })}
        </div>
      )}

      {/* ============= MILESTONE TRACKING — where awards are seen =============
          The awards needed a place to live: pending boxes above show what can
          be opened NOW, and this is the full record — every milestone, what
          was opened and when (with the item it held), and live progress toward
          the ones still ahead. Opened state comes from the local ledger, same
          as the streak itself. */}
      {!compact && (
        <div className="overflow-hidden rounded-2xl border border-border">
          <div className="flex items-center gap-2 border-b border-border bg-card/60 px-3.5 py-2.5">
            <Award size={13} className="text-primary" />
            <p className="text-[12px] font-display font-bold uppercase tracking-wider">Streak awards</p>
          </div>
          <ul className="divide-y divide-border/60">
            {BOX_MILESTONES.map((m) => {
              const meta = AVATAR_RARITY[m.rarity];
              const entry = opened.find((b) => b.source === m.source && b.threshold === m.threshold);
              const isPending = pending.some(
                (b) => b.milestone.source === m.source && b.milestone.threshold === m.threshold,
              );
              const current =
                m.source === "streak" ? streak.current : qualifying ?? null;
              const pct = Math.max(0, Math.min(100, ((current ?? 0) / m.threshold) * 100));
              const heldName = entry?.itemId ? getItem(entry.itemId)?.name ?? entry.itemId : null;

              return (
                <li key={keyOf(m.source, m.threshold)} className="flex items-center gap-3 px-3.5 py-2.5">
                  <span
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[11px] font-black"
                    style={{
                      background: entry
                        ? meta.gradient
                        : isPending
                          ? `${meta.color}25`
                          : "hsl(var(--muted))",
                      color: entry ? "#fff" : isPending ? meta.color : "hsl(var(--muted-foreground))",
                    }}
                  >
                    {entry ? <Check size={13} /> : m.source === "referral" ? <Users size={13} /> : <Flame size={13} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold">{m.label}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {entry
                        ? `Opened ${entry.openedOn}${heldName ? ` · ${heldName}` : ""}`
                        : isPending
                          ? "Ready to open above"
                          : current == null
                            ? `Unlocks at ${m.threshold} ${m.source === "streak" ? "days" : "qualifying referrals"}`
                            : `${current} / ${m.threshold} ${m.source === "streak" ? "days" : "referrals"}`}
                    </p>
                    {!entry && !isPending && current != null && (
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full transition-[width] duration-500"
                          style={{ width: `${pct}%`, background: meta.gradient }}
                        />
                      </div>
                    )}
                  </div>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[12px] font-bold uppercase tracking-wider"
                    style={{ color: meta.color, background: `${meta.color}18` }}
                  >
                    {meta.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Reveal: the item on the athlete's own avatar, at the moment it lands. */}
      <AnimatePresence>
        {revealed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 px-6 backdrop-blur-sm"
            onClick={() => setRevealed(null)}
          >
            <motion.div
              initial={{ scale: 0.85, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xs overflow-hidden rounded-3xl border p-5 text-center"
              style={{
                borderColor: `${AVATAR_RARITY[revealed.grant.rarity].color}66`,
                background: `linear-gradient(180deg, hsl(220 45% 12%), hsl(220 60% 6%))`,
                boxShadow: `0 0 40px ${AVATAR_RARITY[revealed.grant.rarity].glow}55`,
              }}
            >
              <p className="text-[12px] font-black uppercase tracking-wider text-white/70">
                {revealed.box.milestone.label}
              </p>
              <div className="mx-auto mt-3 h-36 w-36">
                <AvatarCharacter
                  loadout={{ ...DEFAULT_LOADOUT, [revealed.grant.category]: revealed.grant.itemId }}
                  size={144}
                  animated={false}
                  showBadge={false}
                />
              </div>
              <p className="mt-2 font-display text-lg font-black">{revealed.grant.name}</p>
              <p className="text-[12px] font-bold uppercase tracking-wider" style={{ color: AVATAR_RARITY[revealed.grant.rarity].color }}>
                {AVATAR_RARITY[revealed.grant.rarity].label}
                {revealed.grant.value > 0 ? ` · worth ${revealed.grant.value} Coins` : ""}
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {revealed.grant.alreadyClaimed
                  ? "You had already opened this box — here is what it held."
                  : "Added to your avatar. Wear it in Avatar Studio."}
              </p>
              <button
                type="button"
                onClick={() => {
                  setRevealed(null);
                  navigate("/avatar");
                }}
                className="mt-4 w-full rounded-2xl bg-gradient-electric py-2.5 text-[12px] font-black uppercase tracking-wider text-white shadow-glow-electric active:scale-[0.99]"
              >
                Wear it now
              </button>
              <button
                type="button"
                onClick={() => setRevealed(null)}
                className="mt-2 w-full text-[12px] font-bold uppercase tracking-wider text-muted-foreground"
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
