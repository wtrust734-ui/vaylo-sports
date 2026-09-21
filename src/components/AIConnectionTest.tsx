import { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { testAIConnection } from "@/lib/aiService";

/** Small diagnostic card that verifies the AI service end-to-end. */
const AIConnectionTest = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      setResult((await testAIConnection()).text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles size={16} className="text-primary" />
        <h4 className="font-semibold text-sm">AI Service Status</h4>
      </div>
      <p className="text-xs text-muted-foreground mb-3">Runs a live check against the AI backend.</p>

      <motion.button whileTap={{ scale: 0.98 }} onClick={run} disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground font-semibold py-2.5 rounded-xl text-sm disabled:opacity-60">
        {loading ? <><Loader2 size={16} className="animate-spin" /> Testing…</> : "Run AI test"}
      </motion.button>

      {result && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-primary/10 border border-primary/30 p-3">
          <CheckCircle2 size={16} className="text-primary mt-0.5 shrink-0" />
          <p className="text-xs text-foreground">{result}</p>
        </div>
      )}
      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-destructive/10 border border-destructive/30 p-3">
          <AlertTriangle size={16} className="text-destructive mt-0.5 shrink-0" />
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
};

export default AIConnectionTest;
