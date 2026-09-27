import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.0";
import { fetchAthleteDossier, formatDossierForPrompt } from "../_shared/athleteDossier.ts";
import { MODELS } from "../_shared/aiModels.ts";
import { refundCredits } from "../_shared/refund.ts";
import { languageDirective } from "../_shared/openai.ts";
import { throttled } from "../_shared/guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Charge happens up-front — remember it so a failed review can be refunded.
  let chargedCredits = 0;
  let chargedUserId: string | null = null;
  let chargedUrl = "";

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const sb = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: authHeader || "" } },
    });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (throttled(user.id)) {
      return new Response(JSON.stringify({ error: "Too many AI requests. Wait a moment and try again." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Charge 3 credits per review — single authoritative deduction via credits_spend().
    // The client must pass no amount; cost is resolved server-side from economy_config.
    const { data: spend, error: spendErr } = await sb.rpc("credits_spend", {
      p_feature: "weekly_coach_review",
      p_reason: "Weekly Coach Review",
      p_source: "weekly-review",
    });
    if (spendErr) {
      return new Response(JSON.stringify({ error: spendErr.message }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!spend?.success) {
      return new Response(JSON.stringify({
        error: `Not enough credits for Weekly Coach Review. Need ${spend?.cost ?? 3} credits — you are ${spend?.shortfall ?? 0} short.`,
        shortfall: spend?.shortfall ?? null,
        cost: spend?.cost ?? 3,
      }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    chargedCredits = spend?.cost ?? 3;
    chargedUserId = user.id;
    chargedUrl = supabaseUrl;

    const body = await req.json().catch(() => ({}));
    // Cap what the athlete can inject into the prompt (abuse guard).
    const statsRaw = body?.stats;
    const stats = statsRaw && typeof statsRaw === "object" ? statsRaw : {};
    const statsJson = JSON.stringify(stats, null, 2).slice(0, 20_000);
    const pbs = body?.pbs;
    const userLocale = typeof body?.userLocale === "string" ? body.userLocale : undefined;
    const langDirective = languageDirective(userLocale);

    let dossierText = "";
    try {
      const serviceClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const dossier = await fetchAthleteDossier(serviceClient, user.id, Array.isArray(pbs) ? pbs : null);
      dossierText = formatDossierForPrompt(dossier);
    } catch (e) {
      console.error("dossier fetch failed", e);
    }

    const prompt = `You are Vaylo Sports Coach, a brutally honest performance coach. Give a weekly accountability review based on the athlete data below. Be direct, no fluff. 5 short sections in markdown:
1. **Verdict** (one line)
2. **What worked**
3. **What broke** (call out missed actions)
4. **Adjust this week** (concrete process-goal changes)
5. **Effort → result** (link consistency to outcomes)

Athlete data (last 7 days):
${statsJson}

${dossierText ? `Full athlete dossier (use to tailor advice — PBs, goals, injuries, recovery, metrics):\n${dossierText}` : ""}`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODELS.CHAT.MINI,
        messages: [
          { role: "system", content: "You are a direct, performance-focused coach. No motivational fluff. Always personalize using the athlete dossier — injuries, goals, PBs, readiness." + (langDirective ? "\n\n" + langDirective : "") },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("ai error", r.status, t);
      // Charged but no review delivered — refund.
      if (chargedUserId) {
        await refundCredits({
          supabaseUrl: chargedUrl,
          serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          userId: chargedUserId,
          amount: chargedCredits,
          reason: "Weekly Coach Review failed — AI error (auto refund)",
        });
        chargedUserId = null;
      }
      return new Response(JSON.stringify({ error: "AI error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await r.json();
    const feedback = data?.choices?.[0]?.message?.content ?? "No feedback generated.";
    return new Response(JSON.stringify({ feedback, balance: spend?.balance ?? null, cost: spend?.cost ?? 3 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    // Charged, then crashed before the review was produced: refund.
    if (chargedUserId) {
      await refundCredits({
        supabaseUrl: chargedUrl,
        serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        userId: chargedUserId,
        amount: chargedCredits,
        reason: "Weekly Coach Review failed — server error (auto refund)",
      });
      chargedUserId = null;
    }
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "err" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
