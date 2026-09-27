import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { motion } from "framer-motion";
import { Sparkles, Check } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

export default function BecomeCreator() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState({ display_name: "", bio: "", specialties: "", payout_email: "" });

  const submit = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("creator_profiles").upsert({
        user_id: user.id,
        display_name: data.display_name,
        bio: data.bio,
        specialties: data.specialties.split(",").map((s) => s.trim()).filter(Boolean),
        payout_email: data.payout_email,
      }, { onConflict: "user_id" });
      if (error) throw error;
      toast.success("Welcome to the marketplace!");
      navigate("/market");
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="px-5 pt-8 pb-24 max-w-xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-electric-purple to-energy flex items-center justify-center mb-4">
          <Sparkles className="h-7 w-7 text-white" />
        </div>
        <h1 className="text-2xl font-bold mb-1">Become a creator</h1>
        <p className="text-sm text-muted-foreground mb-6">Sell programs, meal plans, and 1-on-1 sessions. You keep 80% — Vaylo Sports's fee is 20%.</p>

        <div className="space-y-3 mb-6">
          <Input placeholder="Display name" value={data.display_name} onChange={(e) => setData({ ...data, display_name: e.target.value })} className="h-12" />
          <Textarea placeholder="Tell athletes about yourself, your credentials, your style." rows={4} value={data.bio} onChange={(e) => setData({ ...data, bio: e.target.value })} />
          <Input placeholder="Specialties (comma separated, e.g. Strength, Marathon, HIIT)" value={data.specialties} onChange={(e) => setData({ ...data, specialties: e.target.value })} className="h-12" />
          <Input placeholder="Payout email" type="email" value={data.payout_email} onChange={(e) => setData({ ...data, payout_email: e.target.value })} className="h-12" />
        </div>

        <div className="p-4 rounded-2xl bg-card border border-border space-y-2 text-sm mb-6">
          {["Reach thousands of athletes", "Set your own prices", "Monthly Stripe payouts", "Verified badge after 5 sales"].map((t) => (
            <div key={t} className="flex items-center gap-2"><Check className="h-4 w-4 text-energy" /> <span>{t}</span></div>
          ))}
        </div>

        <Button onClick={submit} disabled={!data.display_name || busy} className="w-full h-12 bg-gradient-to-r from-electric-purple to-energy">
          {busy ? "Submitting…" : "Submit application"}
        </Button>
      </motion.div>
    </div>
  );
}
