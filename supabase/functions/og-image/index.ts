/**
 * og-image — dynamic Open Graph cards for shared links.
 *
 * GET /functions/v1/og-image?kind=challenge&id=<uuid>
 * GET /functions/v1/og-image?kind=profile&id=<uuid>
 *
 * Returns image/png at 1200×630. Public endpoint (crawlers cannot send a JWT):
 * deploy with --no-verify-jwt. Responses are cached an hour so viral spikes
 * don't re-render the same card.
 */
import handler from "./handler.tsx";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  try {
    const res = await handler(req);
    const headers = new Headers(res.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "public, max-age=3600, s-maxage=3600");
    if (headers.get("content-type")?.includes("application/json")) {
      // Error path from the renderer — keep JSON status.
      return new Response(res.body, { status: res.status, headers });
    }
    headers.set("Content-Type", "image/png");
    return new Response(res.body, { status: 200, headers });
  } catch (err) {
    console.error("og-image error", err);
    return new Response(JSON.stringify({ error: "Failed to render image" }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
