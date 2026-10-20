// ============================================================================
// BetaFeedback — how a tester reports a problem without leaving the app.
// ----------------------------------------------------------------------------
// Reuses the production support-request function (validated, honeypot-armed,
// stored per user, emailed to the operator). Nothing here can expose secrets:
// the submitted body is free text the tester writes, plus the studio view they
// were on — never tokens, prompts-as-data or provider keys.
// ============================================================================

import { useState } from "react";
import { Bug, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

type Props = { view: string; open: boolean; onClose: () => void };

export default function BetaFeedback({ view, open, onClose }: Props) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  const submit = async () => {
    if (busy || body.trim().length < 10) return;
    setBusy(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const email = sessionData.session?.user?.email ?? "";
      if (!email) throw new Error("You are signed out — sign in to send feedback.");
      // The studio view the test ran on, so a failure can be reproduced.
      const text = `[Ads Studio beta · ${view}] ${body.trim()}`;
      const { data, error: fnError } = await supabase.functions.invoke("support-request", {
        body: { category: "bug", email, body: text, subject: "Ads Studio beta feedback" },
      });
      if (fnError) throw new Error(fnError.message);
      const ref = (data as { reference?: string } | null)?.reference ?? "saved";
      setReference(ref);
      setBody("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send feedback.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!o && !busy ? onClose() : undefined)}>
      <DialogContent className="w-[min(92vw,440px)] border-white/15 bg-[#0d1017] text-white">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bug className="h-4 w-4" /> Report a problem</DialogTitle>
          <DialogDescription className="text-white/50">
            Sent to the team with the studio screen you are on ({view}). Never include API keys,
            passwords or uploaded files — we only need what you saw and what you expected.
          </DialogDescription>
        </DialogHeader>

        {reference ? (
          <div className="space-y-3 text-sm">
            <p className="text-emerald-400">Feedback saved — reference {reference}.</p>
            <button onClick={onClose} className="rounded-lg bg-white/10 px-3 py-2 text-sm">Close</button>
          </div>
        ) : (
          <div className="space-y-3">
            <textarea
              className="min-h-[110px] w-full rounded-lg bg-black/40 px-3 py-2 text-sm"
              placeholder="What happened, what you expected, and what you did just before."
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={4000}
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded-lg bg-white/10 px-3 py-2 text-sm">Cancel</button>
              <button
                onClick={submit}
                disabled={busy || body.trim().length < 10}
                className="flex items-center gap-2 rounded-lg bg-[#8505D5] px-3 py-2 text-sm text-white disabled:opacity-40"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Send feedback
              </button>
            </div>
          </div>
        )}
        <button onClick={onClose} aria-label="Close feedback" className="absolute right-3 top-3 rounded p-1 text-white/50 hover:bg-white/10">
          <X className="h-4 w-4" />
        </button>
      </DialogContent>
    </Dialog>
  );
}
