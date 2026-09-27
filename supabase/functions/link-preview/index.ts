/**
 * link-preview — crawler-facing landing for shared links.
 *
 * A pure SPA (index.html only) cannot give every shared URL its own Open Graph
 * tags. Shared links therefore point here instead of the app:
 *
 *   /functions/v1/link-preview?kind=challenge&id=<uuid>&ref=CODE
 *
 * The function reads the public row, returns real og:* meta tags pointing at
 * the og-image function's rendered PNG, then redirects humans to the app
 * (/c/:id). Deploy with --no-verify-jwt. Set PUBLIC_APP_URL to the public site
 * (e.g. https://vaylosports.com) as a Supabase secret.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const fnBase = () => `${Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "")}/functions/v1`;

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

const html = (title: string, description: string, imageUrl: string, redirectTo: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${esc(imageUrl)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(imageUrl)}" />
<meta http-equiv="refresh" content="0;url=${esc(redirectTo)}" />
<script>location.replace(${JSON.stringify(redirectTo)});</script>
</head>
<body style="font-family:system-ui;background:#0b0b12;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<a href="${esc(redirectTo)}" style="color:#22d3ee">Open in Vaylo Sports →</a>
</body>
</html>`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "";
  const id = (url.searchParams.get("id") ?? "").trim();
  const ref = (url.searchParams.get("ref") ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12);

  const appBase = (Deno.env.get("PUBLIC_APP_URL") ?? "https://vaylosports.com").replace(/\/$/, "");
  const withRef = (path: string) => `${appBase}${path}${ref ? `${path.includes("?") ? "&" : "?"}ref=${ref}` : ""}`;
  const fallbackCard = `${fnBase()}/og-image`;

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (kind === "challenge" && isUuid(id)) {
      const { data } = await admin
        .from("challenges")
        .select("title, description, participant_count, target_value, target_unit")
        .eq("id", id)
        .maybeSingle();
      const title = data?.title ? `${data.title} — Vaylo Sports Challenge` : "Vaylo Sports Challenge";
      const bits = [
        data?.description ? String(data.description).slice(0, 140) : "Think you can keep up?",
        data?.participant_count ? `${data.participant_count} athletes in` : "",
      ].filter(Boolean);
      const image = `${fnBase()}/og-image?kind=challenge&id=${id}`;
      return new Response(html(title, bits.join(" · "), image, withRef(`/c/${id}`)), {
        headers: { ...CORS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=600" },
      });
    }

    if (kind === "profile" && isUuid(id)) {
      const { data } = await admin.from("avatars").select("display_name").eq("user_id", id).maybeSingle();
      const name = data?.display_name || "A Vaylo Sports athlete";
      const title = `${name} on Vaylo Sports`;
      const description = "Track PBs, join challenges, climb the leaderboard.";
      const image = `${fnBase()}/og-image?kind=profile&id=${id}`;
      return new Response(html(title, description, image, withRef(`/profile/${id}`)), {
        headers: { ...CORS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=600" },
      });
    }

    // Unknown kind: generic app card, straight to the site.
    return new Response(html("Vaylo Sports", "AI coaching, challenges and leaderboards for your sport.", fallbackCard, appBase), {
      headers: { ...CORS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=600" },
    });
  } catch (err) {
    console.error("link-preview error", err);
    return new Response(html("Vaylo Sports", "AI coaching for your sport.", fallbackCard, appBase), {
      headers: { ...CORS, "Content-Type": "text/html; charset=utf-8" },
    });
  }
});
