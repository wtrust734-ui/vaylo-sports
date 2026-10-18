// ============================================================================
// FLEX CARD — the shareable unlock card
// ----------------------------------------------------------------------------
// A vertical, story-format card (9:16 at a fixed 340×604 capture width) that
// wraps one unlock in maximal hype and minimal clutter:
//
//   HEADER    the rarity headline ("NEW MYTHIC UNLOCKED!" / "LEGENDARY
//             STATUS ACHIEVED" / …) — same string flexShare.flexCaption
//             builds the caption around, so image and text never disagree.
//   SHOWCASE  the item: giant icon on a rarity glow, name, rarity chip,
//             description.
//   STATS     the athlete: name, optional streak and level chips, and the
//             look they wear now (title · border · backdrop names) — the flex
//             is about the person, not only the item.
//   FOOTER    the branded CTA: "Vaylo Sports · Train like a pro".
//
// Pure presentational: every value arrives by prop, no store subscription, so
// the same card renders identically inside the celebration modal, in a test,
// and inside html2canvas's capture. Fixed pixel width so the captured PNG is
// deterministic across devices.
// ============================================================================

import { resolveIcon } from "./icons";
import { flexHeadline } from "@/lib/cosmeticsShop/flexShare";
import { RARITY_LADDER, type CosmeticItem } from "@/lib/cosmeticsShop/types";

export interface FlexCardProps {
  item: CosmeticItem;
  athleteName: string;
  /** Days in a row, when the caller knows it — rendered as a chip. */
  streakDays?: number;
  /** Athlete level, when the caller knows it — rendered as a chip. */
  level?: number;
  /** The look they wear now — names only; the card is about this unlock. */
  look?: { title?: string; border?: string; backdrop?: string };
  /** Overrides the branded footer line (white-label builds). */
  appName?: string;
}

export default function FlexCard({
  item,
  athleteName,
  streakDays,
  level,
  look,
  appName = "Vaylo Sports",
}: FlexCardProps) {
  const rarity = RARITY_LADDER[item.rarity];
  const Icon = resolveIcon(item.icon);
  const lookLine = [look?.title, look?.border, look?.backdrop].filter(Boolean).join(" · ");

  return (
    <div
      data-testid="flex-card"
      className="flex w-[340px] flex-col overflow-hidden rounded-[28px] border p-6 text-center"
      style={{
        aspectRatio: "9 / 16",
        background: item.style.gradient ?? "linear-gradient(180deg, #0b1026 0%, #1a1040 55%, #020617 100%)",
        borderColor: `${rarity.color}66`,
        boxShadow: `0 0 28px ${rarity.color}40`,
      }}
    >
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <p
        className="font-display text-[15px] font-black uppercase tracking-[0.18em]"
        style={{ color: rarity.color }}
      >
        {flexHeadline(item.rarity)}
      </p>
      <span
        className="mx-auto mt-2 w-fit rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
        style={{ color: rarity.color, borderColor: `${rarity.color}55` }}
      >
        {rarity.label}
      </span>

      {/* ── SHOWCASE ───────────────────────────────────────────────────── */}
      <div className="mt-6 flex flex-1 flex-col items-center justify-center">
        <div
          className="flex h-24 w-24 items-center justify-center rounded-3xl"
          style={{ backgroundColor: `${rarity.color}18`, boxShadow: `0 0 24px ${rarity.color}55` }}
        >
          <Icon size={44} style={{ color: rarity.color }} />
        </div>
        <p className="mt-4 font-display text-2xl font-black leading-tight">{item.name}</p>
        <p className="mt-1 max-w-[260px] text-[12px] leading-relaxed text-white/70">{item.description}</p>
      </div>

      {/* ── ATHLETE ────────────────────────────────────────────────────── */}
      <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
        <p className="truncate text-sm font-bold">{athleteName}</p>
        <div className="mt-1.5 flex items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-white/60">
          {typeof streakDays === "number" && streakDays > 0 && <span>🔥 {streakDays}-day streak</span>}
          {typeof level === "number" && level > 0 && <span>⭐ Level {level}</span>}
        </div>
        {lookLine && <p className="mt-1 truncate text-[10px] text-white/50">{lookLine}</p>}
      </div>

      {/* ── FOOTER / WATERMARK ─────────────────────────────────────────── */}
      <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
        {appName} · Train like a pro
      </p>
    </div>
  );
}
