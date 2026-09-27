/**
 * handler.tsx — renders the actual OG card image.
 *
 * Two card kinds, chosen by query param:
 *   ?kind=challenge&id=<uuid>  → challenge invite card (title, target, dates)
 *   ?kind=profile&id=<uuid>    → athlete card (public display name + invite CTA)
 *
 * Data shown here is intentionally public: challenges are readable by anon
 * (see growth migration) and display names come from the public `avatars`
 * table. Nothing private (email, credits, PB values) is ever rendered.
 */
import { ImageResponse } from "npm:@vercel/og@^0";
import React from "npm:react@^19";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";

const WIDTH = 1200;
const HEIGHT = 630;

const INK = "#0b0b12";
const CARD = "#14141f";
const ELECTRIC = "#7c3aed";
const ENERGY = "#22d3ee";
const MUTED = "#9ca3af";

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

async function challengeCard(id: string) {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data } = await admin
    .from("challenges")
    .select("title, description, sport, target_value, target_unit, end_date, participant_count")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const unit = data.target_unit ? ` ${data.target_unit}` : "";
  return {
    kicker: "VAYLO CHALLENGE",
    title: data.title || "Challenge",
    lines: [
      data.description ? String(data.description).slice(0, 110) : "",
      [
        data.target_value ? `Target: ${data.target_value}${unit}` : "",
        data.sport ? String(data.sport).replace(/^\w/, (c) => c.toUpperCase()) : "",
        data.participant_count ? `${data.participant_count} athletes in` : "",
        data.end_date ? `Ends ${String(data.end_date).slice(0, 10)}` : "",
      ].filter(Boolean).join("  ·  "),
    ].filter(Boolean),
    cta: "Tap to view & join →",
  };
}

async function profileCard(id: string) {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data } = await admin
    .from("avatars")
    .select("display_name")
    .eq("user_id", id)
    .maybeSingle();
  if (!data) return null;
  const name = data.display_name || "Vaylo Sports Athlete";
  return {
    kicker: "VAYLO SPORTS",
    title: name,
    lines: ["Is training on Vaylo Sports.", "Track PBs, join challenges, climb the leaderboard."],
    cta: "Challenge them & start free →",
  };
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "profile";
  const id = (url.searchParams.get("id") ?? "").trim();

  const card =
    kind === "challenge"
      ? id.match(/^[0-9a-f-]{36}$/i)
        ? await challengeCard(id)
        : null
      : id.match(/^[0-9a-f-]{36}$/i)
        ? await profileCard(id)
        : null;

  const c = card ?? {
    kicker: "VAYLO SPORTS",
    title: "Train like an elite athlete",
    lines: ["AI coaching, challenges and leaderboards for your sport."],
    cta: "Start free →",
  };

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 72px",
          background: `linear-gradient(135deg, ${INK} 0%, #191927 55%, #1d1533 100%)`,
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 54,
              height: 54,
              borderRadius: 14,
              background: `linear-gradient(135deg, ${ELECTRIC}, ${ENERGY})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            V
          </div>
          <div style={{ fontSize: 26, letterSpacing: 6, color: MUTED, fontWeight: 600 }}>{c.kicker}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: c.title.length > 40 ? 64 : 84, fontWeight: 800, lineHeight: 1.05, maxWidth: 1040 }}>
            {esc(c.title)}
          </div>
          {c.lines.map((line, i) => (
            <div key={i} style={{ fontSize: 30, color: i === 0 ? "#d1d5db" : MUTED, lineHeight: 1.3 }}>
              {esc(line)}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 34, fontWeight: 700, color: ENERGY }}>{esc(c.cta)}</div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 600,
              padding: "12px 28px",
              borderRadius: 999,
              background: `linear-gradient(90deg, ${ELECTRIC}, ${ENERGY})`,
            }}
          >
            vaylo sports
          </div>
        </div>
      </div>
    ) as React.ReactNode,
    { width: WIDTH, height: HEIGHT },
  );
}
