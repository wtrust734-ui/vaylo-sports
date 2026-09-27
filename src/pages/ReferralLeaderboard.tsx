import { useEffect, useState } from "react";
import { Trophy, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Public referral leaderboard (/referral-leaderboard) — "Top recruiters this
 * month". Turns every existing user into a salesperson: a public, dated,
 * prize-backed competition. Shared widely; the join CTA harvests signups.
 */
const ReferralLeaderboard = () => {
  const { session } = useAuth();
  const [rows, setRows] = useState<{ rank: number; referrer_id: string; display_name: string; referral_count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc("top_referrers" as never, { p_days: 30 } as never);
      if (cancelled) return;
      if (!error) setRows((data as never as typeof rows) ?? []);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const medal = (rank: number) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `${rank}`);

  return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-12 pb-8 max-w-lg mx-auto">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-energy">Vaylo Sports</p>
        <h1 className="mt-1 text-3xl font-display font-bold">Top recruiters</h1>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          The athletes who brought the most friends to Vaylo Sports this month. The leader wins a
          <span className="text-foreground font-semibold"> free month of Unlimited</span>.
        </p>

        <div className="mt-6 rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
          {loading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
          {!loading && rows.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">
              Nobody has recruited yet this month. <span className="text-foreground font-medium">First entry wins by default.</span>
            </div>
          )}
          {rows.map((r) => (
            <div key={r.referrer_id} className="flex items-center justify-between p-3.5">
              <span className="flex items-center gap-3">
                <span className="w-7 text-center text-lg">{medal(r.rank)}</span>
                <span className="font-medium">{r.display_name}</span>
              </span>
              <span className="flex items-center gap-1 text-sm font-semibold text-energy">
                <Zap size={13} /> {r.referral_count}
              </span>
            </div>
          ))}
        </div>

        {!session ? (
          <a
            href="/auth"
            className="mt-6 block rounded-2xl bg-gradient-to-r from-electric-purple to-energy py-3.5 text-center text-base font-bold text-white"
          >
            Join Vaylo Sports free →
          </a>
        ) : (
          <a
            href="/referrals"
            className="mt-6 block rounded-2xl border border-energy/40 py-3.5 text-center text-sm font-semibold text-energy"
          >
            Get your invite code →
          </a>
        )}

        <p className="mt-5 text-center text-[11px] text-muted-foreground">
          AI coaching, challenges and leaderboards for your sport. Free to start.
        </p>
      </div>
    </div>
  );
};

export default ReferralLeaderboard;
