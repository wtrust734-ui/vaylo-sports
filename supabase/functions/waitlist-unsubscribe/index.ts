import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ============================================================================
// waitlist-unsubscribe — one-click removal from the waiting list
// ----------------------------------------------------------------------------
// The split between GET and POST is the whole design, and it is not cosmetic.
//
//   GET  renders a page. It changes nothing.
//   POST performs the removal.
//
// Mail clients, security scanners and link-prefetchers fetch every URL in a
// message before a human sees it. If GET unsubscribed, people would be removed
// from the list by a scanner they never touched — and would never know why the
// release email did not arrive. So the link in the email opens a page whose
// button is the only thing that removes anyone.
//
// POST also serves RFC 8058 one-click: when a mail client offers its own
// "unsubscribe" control it POSTs `List-Unsubscribe=One-Click`, which is a real
// click by a real person and is honoured here.
//
// The token is a per-recipient random UUID. It is not derived from the address,
// so holding a token tells you nothing about who is on the list, and there is
// no endpoint anywhere that answers "is this address on the list?" — which is
// the enumeration problem the waiting-list page warns about and which the
// self-service route here must not reintroduce.
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function page(title: string, body: string, status = 200) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title} &middot; Vaylo Sports</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;background:#05070f;color:#e8ecf6;
    font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    display:flex;align-items:center;justify-content:center;padding:24px}
  main{max-width:520px;background:#0d1120;border:1px solid #1d2438;border-radius:14px;padding:28px}
  h1{font-size:20px;margin:0 0 10px}
  p{color:#a9b3c9;margin:0 0 14px}
  button{background:linear-gradient(135deg,#ff5fa2,#4f8cff);color:#07070d;border:0;
    border-radius:9px;padding:11px 18px;font-size:14px;font-weight:700;cursor:pointer}
  .muted{color:#6f7a96;font-size:13px}
</style>
</head>
<body><main>
<h1>${title}</h1>
${body}
<p class="muted">Vaylo Sports &middot; vaylosportssupport@gmail.com</p>
</main></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" },
  });
}

function tokenFrom(url: URL, form: FormData | null): string {
  const fromQuery = url.searchParams.get("token");
  if (fromQuery) return fromQuery.trim();
  const fromForm = form?.get("token");
  return typeof fromForm === "string" ? fromForm.trim() : "";
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceKey) return page("Not available", "<p>This page is not configured.</p>", 500);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

  // ---------------------------------------------------------------- render --
  if (req.method === "GET") {
    const token = tokenFrom(url, null);
    if (!UUID_RE.test(token)) {
      return page(
        "This link is not valid",
        "<p>This unsubscribe link is incomplete or has been altered in transit. If you want to leave the waiting list, reply to any Vaylo Sports email and we will remove you.</p>",
        400,
      );
    }

    const { data } = await admin
      .from("waitlist_signups")
      .select("unsubscribed_at")
      .eq("unsubscribe_token", token)
      .maybeSingle();

    if (!data) {
      return page(
        "This link is not valid",
        "<p>We could not find that waiting-list entry. It may already have been removed, or the link may have been altered. Replying to any Vaylo Sports email also works.</p>",
        404,
      );
    }

    if (data.unsubscribed_at) {
      return page(
        "You are already off the list",
        "<p>This address was removed on request and will not receive any further email from the Vaylo Sports waiting list.</p>",
      );
    }

    // The removal itself. A form POST, not a link — see the note at the top.
    return page(
      "Leave the waiting list?",
      `<p>Clicking the button below removes this address from the Vaylo Sports waiting list immediately. No further email will be sent, including the message that tells you the Android release has opened.</p>
       <form method="POST" action="/functions/v1/waitlist-unsubscribe?token=${encodeURIComponent(token)}">
         <input type="hidden" name="token" value="${token}">
         <button type="submit">Yes, remove me from the list</button>
       </form>`,
    );
  }

  // ----------------------------------------------------------------- remove --
  if (req.method === "POST") {
    let form: FormData | null = null;
    try {
      form = await req.formData();
    } catch {
      // A one-click POST may carry no body at all; the token is in the query.
    }

    const token = tokenFrom(url, form);
    if (!UUID_RE.test(token)) return page("This link is not valid", "<p>No valid token was supplied.</p>", 400);

    const { data, error } = await admin
      .from("waitlist_signups")
      .update({ unsubscribed_at: new Date().toISOString() })
      .eq("unsubscribe_token", token)
      .select("unsubscribed_at");

    if (error) {
      console.error("unsubscribe failed", error.code);
      return page("Something went wrong", "<p>We could not complete that. Please reply to any Vaylo Sports email and we will remove you.</p>", 500);
    }

    if (!data?.length) {
      // Either the token never existed or it was already used. Both are
      // answered identically: a distinct "already unsubscribed" response would
      // distinguish a live token from a dead one to anyone guessing.
      return page("This link is not valid", "<p>That entry could not be found, or it has already been removed.</p>", 404);
    }

    return page(
      "You are off the list",
      "<p>This address has been removed from the Vaylo Sports waiting list. Nothing further will be sent to it, and the removal is recorded rather than the entry being silently deleted.</p>",
    );
  }

  return page("Not allowed", "<p>That method is not supported here.</p>", 405);
});
