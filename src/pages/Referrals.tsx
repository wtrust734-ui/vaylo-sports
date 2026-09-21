import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { motion } from "framer-motion";
import { Gift, Copy, Check, Users, Crown } from "lucide-react";
import { publicAppUrl } from "@/lib/share";
import { toast } from "sonner";

function genCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default function Referrals() {
  const { user } = useAuth();
  const [code, setCode] = useState<string>("");
  const [referrals, setReferrals] = useState<any[]>([]);
  const [redeem, setRedeem] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      let { data } = await (supabase as any).from("referral_codes").select("code").eq("user_id", user.id).maybeSingle();
      if (!data) {
        const newCode = genCode();
        const { data: ins, error: insError } = await (supabase as any).from("referral_codes").insert({ user_id: user.id, code: newCode }).select().maybeSingle();
        if (insError) { toast.error(`Couldn't create your referral code: ${insError.message}`); return; }
        data = ins;
      }
      setCode(data?.code || "");
      const { data: refs } = await (supabase as any).from("referrals").select("*").eq("referrer_id", user.id);
      setReferrals(refs || []);
    })();
  }, [user]);

  // Shared links must not point at capacitor://localhost on a device.
  const link = publicAppUrl(`/auth?ref=${code}`) || `${window.location.origin}/auth?ref=${code}`;

  const doRedeem = async () => {
    setBusy(true);
    try {
      const { error } = await (supabase as any).rpc("redeem_referral", { p_code: redeem.trim().toUpperCase() });
      if (error) throw error;
      toast.success("Code applied — 14 days of Pro on us!");
      setRedeem("");
    } catch (e: any) { toast.error(e.message || "Invalid code"); }
    finally { setBusy(false); }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(link);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  const granted = referrals.filter((r) => r.status === "granted").length;

  return (
    <div className="px-5 pt-8 pb-24 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold flex items-center gap-2 mb-1"><Gift className="h-6 w-6 text-energy" /> Refer & earn</h1>
      <p className="text-sm text-muted-foreground mb-6">Share Vaylo with friends. They get 14 days of Pro, you get 30 days.</p>

      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl p-6 bg-gradient-to-br from-electric-purple/30 via-card to-energy/10 border border-electric-purple/40 mb-6">
        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Your code</p>
        <div className="flex items-center gap-2 mb-3">
          <p className="text-3xl font-bold font-mono">{code}</p>
        </div>
        <div className="flex gap-2">
          <Input value={link} readOnly className="font-mono text-xs" />
          <Button onClick={copy} variant="outline" className="shrink-0">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="p-4 rounded-2xl bg-card border border-border">
          <Users className="h-4 w-4 text-electric-purple mb-2" />
          <p className="text-2xl font-bold">{referrals.length}</p>
          <p className="text-xs text-muted-foreground">Friends invited</p>
        </div>
        <div className="p-4 rounded-2xl bg-card border border-border">
          <Crown className="h-4 w-4 text-energy mb-2" />
          <p className="text-2xl font-bold">{granted * 30}</p>
          <p className="text-xs text-muted-foreground">Pro days earned</p>
        </div>
      </div>

      <div className="p-5 rounded-2xl border border-border bg-card">
        <p className="font-semibold mb-1">Got a code?</p>
        <p className="text-xs text-muted-foreground mb-3">Enter a friend's code to claim 14 days of Pro.</p>
        <div className="flex gap-2">
          <Input value={redeem} onChange={(e) => setRedeem(e.target.value)} placeholder="ABC123" className="font-mono uppercase" />
          <Button onClick={doRedeem} disabled={!redeem || busy}>Redeem</Button>
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground mt-4 text-center">One redemption per account. Rewards are auto-applied. Self-referrals and disposable accounts are not eligible.</p>
    </div>
  );
}
