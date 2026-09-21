import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Loader2, CheckCircle2, AlertTriangle, Cpu, Clock, Hash } from "lucide-react";
import { fetchAICatalog, runAIDetailed, testAIConnection, type AIFeature, type AIResult } from "@/lib/aiService";

type CatalogEntry = Awaited<ReturnType<typeof fetchAICatalog>>[number];

/** Developer-only AI testing console. Route: /ai-dev */
const AIDev = () => {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [feature, setFeature] = useState<AIFeature | "">("");
  const [prompt, setPrompt] = useState("");
  const [extraSystem, setExtraSystem] = useState("");
  const [userData, setUserData] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AIResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  useEffect(() => {
    fetchAICatalog()
      .then((f) => {
        setCatalog(f);
        setFeature((prev) => prev || (f[0]?.name ?? ""));
      })
      .catch((e) => setCatalogError(e instanceof Error ? e.message : "Could not load AI catalog"));
  }, []);

  const selected = useMemo(() => catalog.find((f) => f.name === feature), [catalog, feature]);

  const run = async (fn: () => Promise<AIResult>) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const runSelected = () =>
    run(() => {
      let parsed: Record<string, unknown> | undefined;
      if (userData.trim()) {
        try {
          parsed = JSON.parse(userData);
        } catch {
          throw new Error("Athlete data must be valid JSON.");
        }
      }
      return runAIDetailed({
        feature: feature as AIFeature,
        userPrompt: prompt,
        systemPrompt: extraSystem.trim() || undefined,
        userData: parsed,
      });
    });

  return (
    <div className="min-h-screen pb-24">
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={18} className="text-primary" />
          <h1 className="text-xl font-bold">AI Testing Console</h1>
        </div>
        <p className="text-xs text-muted-foreground">
          Developer tool. Every feature below routes through the central AI service and the aiModels config.
        </p>
      </div>

      <div className="px-5 space-y-4">
        {catalogError && (
          <div className="flex items-start gap-2 rounded-xl bg-destructive/10 border border-destructive/30 p-3">
            <AlertTriangle size={16} className="text-destructive mt-0.5 shrink-0" />
            <p className="text-xs text-destructive">{catalogError}</p>
          </div>
        )}

        {/* Quick verification */}
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="font-semibold text-sm mb-1">Integration check</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Sends: “Say 'VAYLO AI integration successful.'”
          </p>
          <motion.button whileTap={{ scale: 0.98 }} disabled={loading} onClick={() => run(testAIConnection)}
            className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold py-2.5 rounded-xl text-sm disabled:opacity-60">
            {loading ? <><Loader2 size={16} className="animate-spin" /> Running…</> : "Run integration check"}
          </motion.button>
        </div>

        {/* Feature picker */}
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">AI feature</label>
            <select value={feature} onChange={(e) => setFeature(e.target.value as AIFeature)}
              className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/50 focus:outline-none">
              {catalog.map((f) => <option key={f.name} value={f.name}>{f.label}</option>)}
            </select>
          </div>

          {selected && (
            <div className="rounded-xl bg-muted/50 border border-border p-3 space-y-2">
              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="px-2 py-1 rounded-lg bg-primary/15 text-primary font-semibold flex items-center gap-1">
                  <Cpu size={11} /> {selected.model}
                </span>
                <span className="px-2 py-1 rounded-lg bg-secondary text-muted-foreground">max {selected.maxOutputTokens} out</span>
                {selected.allowImages && <span className="px-2 py-1 rounded-lg bg-secondary text-muted-foreground">vision</span>}
                {selected.useHistory && <span className="px-2 py-1 rounded-lg bg-secondary text-muted-foreground">history</span>}
              </div>
              <details>
                <summary className="text-xs text-muted-foreground cursor-pointer">System prompt</summary>
                <pre className="mt-2 text-[11px] whitespace-pre-wrap text-muted-foreground max-h-56 overflow-auto">{selected.system}</pre>
              </details>
            </div>
          )}

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">User prompt</label>
            <textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should the AI do?"
              className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/50 focus:outline-none" />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Extra system context (optional)</label>
            <textarea rows={2} value={extraSystem} onChange={(e) => setExtraSystem(e.target.value)}
              className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/50 focus:outline-none" />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Athlete data JSON (optional)</label>
            <textarea rows={3} value={userData} onChange={(e) => setUserData(e.target.value)}
              placeholder='{"sport":"running","weekly_km":45}'
              className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-xs font-mono text-foreground focus:ring-2 focus:ring-primary/50 focus:outline-none" />
          </div>

          <motion.button whileTap={{ scale: 0.98 }} disabled={loading || !feature} onClick={runSelected}
            className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold py-2.5 rounded-xl text-sm disabled:opacity-60">
            {loading ? <><Loader2 size={16} className="animate-spin" /> Generating…</> : "Send request"}
          </motion.button>
        </div>

        {/* Result */}
        {error && (
          <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle size={16} className="text-destructive" />
              <h4 className="font-semibold text-sm text-destructive">Error</h4>
            </div>
            <p className="text-xs text-destructive break-words">{error}</p>
          </div>
        )}

        {result && (
          <div className="rounded-xl bg-card border border-border p-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 size={16} className="text-primary" />
              <h4 className="font-semibold text-sm">{result.feature}</h4>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] mb-3">
              <span className="px-2 py-1 rounded-lg bg-primary/15 text-primary font-semibold flex items-center gap-1">
                <Cpu size={11} /> {result.model}
              </span>
              <span className="px-2 py-1 rounded-lg bg-secondary text-muted-foreground flex items-center gap-1">
                <Clock size={11} /> {result.durationMs} ms
              </span>
              {result.usage && (
                <span className="px-2 py-1 rounded-lg bg-secondary text-muted-foreground flex items-center gap-1">
                  <Hash size={11} /> {result.usage.inputTokens ?? "?"} in · {result.usage.outputTokens ?? "?"} out · {result.usage.totalTokens ?? "?"} total
                </span>
              )}
            </div>
            <pre className="text-xs whitespace-pre-wrap text-foreground max-h-[26rem] overflow-auto">{result.text}</pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIDev;
