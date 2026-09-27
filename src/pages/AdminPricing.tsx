import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Shield, Save, Plus, Trash2, TrendingUp, DollarSign, Users, Globe2, BarChart3 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatLocalPrice } from "@/lib/creditEconomy";

type Tier = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  packs: any[];
  infinite: any[];
  active: boolean;
  sort_order: number;
};

type CountryRow = {
  country_code: string;
  country_name: string;
  tier_code: string;
  currency: string;
};

const SEG_LABEL: Record<string, string> = {
  new: "New", casual: "Casual", active: "Active", vip: "VIP",
};

export default function AdminPricing() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"tiers" | "countries" | "analytics">("tiers");

  const [tiers, setTiers] = useState<Tier[]>([]);
  const [countries, setCountries] = useState<CountryRow[]>([]);
  const [analytics, setAnalytics] = useState<any>({ byCountry: [], byTier: [], segments: [], totals: { rev: 0, purchases: 0, arpu: 0, unlimited: 0 } });
  const [savingId, setSavingId] = useState<string | null>(null);

  // Check admin role
  useEffect(() => {
    if (!user) { setIsAdmin(false); return; }
    (async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      setIsAdmin(!!data);
    })();
  }, [user]);

  // Load data once admin confirmed
  useEffect(() => {
    if (!isAdmin) return;
    (async () => {
      const [{ data: t }, { data: c }] = await Promise.all([
        supabase.from("pricing_tiers").select("*").order("sort_order"),
        supabase.from("country_pricing_map").select("*").order("country_name"),
      ]);
      setTiers(t || []);
      setCountries(c || []);
      loadAnalytics();
    })();
  }, [isAdmin]);

  const loadAnalytics = async () => {
    const { data: purchases } = await supabase
      .from("purchase_analytics")
      .select("region,currency,amount_cents,event_type,pack_id,user_id")
      .eq("event_type", "purchase");

    const rows = purchases || [];
    const byCountryMap = new Map<string, { country: string; rev: number; count: number; users: Set<string> }>();
    const byTierMap = new Map<string, { tier: string; rev: number; count: number }>();
    const tierByCountry: Record<string, string> = {};
    countries.forEach((c) => { tierByCountry[c.country_code] = c.tier_code; });

    let totalRev = 0;
    let unlimitedCount = 0;
    const userSet = new Set<string>();
    for (const r of rows) {
      const country = r.region || "US";
      const tier = tierByCountry[country] || "?";
      const rev = r.amount_cents || 0;
      totalRev += rev;
      userSet.add(r.user_id);
      if (String(r.pack_id || "").startsWith("infinite_")) unlimitedCount++;

      const bc = byCountryMap.get(country) || { country, rev: 0, count: 0, users: new Set<string>() };
      bc.rev += rev; bc.count++; bc.users.add(r.user_id);
      byCountryMap.set(country, bc);

      const bt = byTierMap.get(tier) || { tier, rev: 0, count: 0 };
      bt.rev += rev; bt.count++;
      byTierMap.set(tier, bt);
    }

    const { data: segs } = await supabase.from("user_segments").select("segment");
    const segCount: Record<string, number> = { new: 0, casual: 0, active: 0, vip: 0 };
    (segs || []).forEach((s) => { segCount[s.segment] = (segCount[s.segment] || 0) + 1; });

    setAnalytics({
      byCountry: Array.from(byCountryMap.values()).map((v) => ({ ...v, users: v.users.size })).sort((a, b) => b.rev - a.rev),
      byTier: Array.from(byTierMap.values()).sort((a, b) => a.tier.localeCompare(b.tier)),
      segments: Object.entries(segCount).map(([k, v]) => ({ segment: k, count: v })),
      totals: {
        rev: totalRev,
        purchases: rows.length,
        arpu: userSet.size ? Math.round(totalRev / userSet.size) : 0,
        unlimited: unlimitedCount,
      },
    });
  };

  const saveTier = async (tier: Tier) => {
    setSavingId(tier.id);
    const { error } = await supabase.from("pricing_tiers").update({
      name: tier.name,
      description: tier.description,
      packs: tier.packs,
      infinite: tier.infinite,
      active: tier.active,
      sort_order: tier.sort_order,
    }).eq("id", tier.id);
    setSavingId(null);
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
    else toast({ title: `Tier ${tier.code} saved` });
  };

  const updatePackPrice = (tierId: string, packIdx: number, cents: number) => {
    setTiers((prev) => prev.map((t) => {
      if (t.id !== tierId) return t;
      const packs = [...t.packs];
      packs[packIdx] = { ...packs[packIdx], price_cents: cents };
      return { ...t, packs };
    }));
  };
  const updateInfinitePrice = (tierId: string, idx: number, cents: number) => {
    setTiers((prev) => prev.map((t) => {
      if (t.id !== tierId) return t;
      const infinite = [...t.infinite];
      infinite[idx] = { ...infinite[idx], price_cents: cents };
      return { ...t, infinite };
    }));
  };

  const updateCountryTier = async (code: string, newTier: string) => {
    setCountries((prev) => prev.map((c) => (c.country_code === code ? { ...c, tier_code: newTier } : c)));
    const { error } = await supabase.from("country_pricing_map").update({ tier_code: newTier }).eq("country_code", code);
    if (error) toast({ title: "Update failed", description: error.message, variant: "destructive" });
  };

  const addCountry = async () => {
    const code = prompt("ISO country code (e.g. FR)")?.toUpperCase();
    if (!code || code.length !== 2) return;
    const name = prompt("Country name") || code;
    const tier_code = prompt("Tier code (A/B/C/D)")?.toUpperCase() || "A";
    const currency = prompt("Currency code (e.g. EUR)")?.toUpperCase() || "USD";
    const { error, data } = await supabase.from("country_pricing_map")
      .insert({ country_code: code, country_name: name, tier_code, currency })
      .select().single();
    if (error) return toast({ title: "Add failed", description: error.message, variant: "destructive" });
    setCountries((p) => [...p, data].sort((a, b) => a.country_name.localeCompare(b.country_name)));
  };

  const removeCountry = async (code: string) => {
    if (!confirm(`Remove ${code}?`)) return;
    const { error } = await supabase.from("country_pricing_map").delete().eq("country_code", code);
    if (error) return toast({ title: "Remove failed", description: error.message, variant: "destructive" });
    setCountries((p) => p.filter((c) => c.country_code !== code));
  };

  if (isAdmin === null) return <div className="p-8 text-sm text-muted-foreground">Checking access…</div>;
  if (!isAdmin) return (
    <div className="min-h-screen flex items-center justify-center p-8 text-center">
      <div>
        <Shield className="mx-auto mb-3 text-muted-foreground" />
        <h1 className="text-xl font-bold mb-1">Admin only</h1>
        <p className="text-sm text-muted-foreground">You need the admin role to view this page.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background pb-24">
      <div className="px-5 pt-14 pb-4">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          className="text-3xl font-display font-bold text-gradient-electric flex items-center gap-2">
          <Shield className="text-primary" /> Pricing Admin
        </motion.h1>
        <p className="text-xs text-muted-foreground mt-1">Manage regional tiers, country mappings, and view revenue analytics.</p>

        <div className="flex gap-2 mt-4">
          {(["tiers","countries","analytics"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-full text-xs font-bold capitalize transition ${tab===t ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground"}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === "tiers" && (
        <div className="px-5 space-y-5">
          {tiers.map((tier) => (
            <div key={tier.id} className="bg-card border border-border rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-electric-purple/20 text-electric-purple text-[10px] font-bold">TIER {tier.code}</span>
                    <input value={tier.name}
                      onChange={(e) => setTiers((p) => p.map((x) => x.id===tier.id ? {...x, name:e.target.value} : x))}
                      className="bg-transparent font-bold text-base outline-none border-b border-transparent focus:border-border" />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{tier.description}</p>
                </div>
                <button onClick={() => saveTier(tier)} disabled={savingId===tier.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold disabled:opacity-50">
                  <Save size={12} /> {savingId===tier.id ? "Saving…" : "Save"}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Credit packs</h4>
                  <div className="space-y-1.5">
                    {tier.packs.map((p: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="w-20 text-muted-foreground">{p.credits} cr</span>
                        {p.bonus > 0 && <span className="text-energy">+{p.bonus}</span>}
                        <span className="ml-auto text-muted-foreground">$</span>
                        <input type="number" step="0.01" min="0"
                          value={(p.price_cents/100).toFixed(2)}
                          onChange={(e) => updatePackPrice(tier.id, i, Math.round(parseFloat(e.target.value || "0") * 100))}
                          className="w-20 bg-background border border-border rounded px-2 py-1 text-right" />
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h4 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Unlimited</h4>
                  <div className="space-y-1.5">
                    {tier.infinite.map((p: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="w-20 text-muted-foreground capitalize">{p.label}</span>
                        <span className="ml-auto text-muted-foreground">$</span>
                        <input type="number" step="0.01" min="0"
                          value={(p.price_cents/100).toFixed(2)}
                          onChange={(e) => updateInfinitePrice(tier.id, i, Math.round(parseFloat(e.target.value || "0") * 100))}
                          className="w-20 bg-background border border-border rounded px-2 py-1 text-right" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "countries" && (
        <div className="px-5">
          <div className="flex justify-between items-center mb-3">
            <p className="text-xs text-muted-foreground">{countries.length} countries mapped</p>
            <button onClick={addCountry} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold">
              <Plus size={12} /> Add country
            </button>
          </div>
          <div className="bg-card border border-border rounded-2xl divide-y divide-border overflow-hidden">
            {countries.map((c) => (
              <div key={c.country_code} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Globe2 size={14} className="text-muted-foreground" />
                <span className="font-mono text-xs w-10 text-muted-foreground">{c.country_code}</span>
                <span className="flex-1 truncate">{c.country_name}</span>
                <span className="text-[11px] text-muted-foreground w-12">{c.currency}</span>
                <select value={c.tier_code} onChange={(e) => updateCountryTier(c.country_code, e.target.value)}
                  className="bg-background border border-border rounded px-2 py-1 text-xs">
                  {tiers.map((t) => <option key={t.code} value={t.code}>{t.code}</option>)}
                </select>
                <button onClick={() => removeCountry(c.country_code)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "analytics" && (
        <div className="px-5 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={DollarSign} label="Revenue" value={`$${(analytics.totals.rev/100).toFixed(0)}`} />
            <StatCard icon={TrendingUp} label="Purchases" value={analytics.totals.purchases} />
            <StatCard icon={Users} label="ARPU" value={`$${(analytics.totals.arpu/100).toFixed(2)}`} />
            <StatCard icon={BarChart3} label="Unlimited subs" value={analytics.totals.unlimited} />
          </div>

          <Section title="Revenue by country">
            {analytics.byCountry.length === 0 ? <Empty /> : analytics.byCountry.map((r: any) => (
              <Row key={r.country} left={r.country} mid={`${r.count} purchases · ${r.users} buyers`} right={`$${(r.rev/100).toFixed(2)}`} />
            ))}
          </Section>

          <Section title="Revenue by pricing tier">
            {analytics.byTier.length === 0 ? <Empty /> : analytics.byTier.map((r: any) => (
              <Row key={r.tier} left={`Tier ${r.tier}`} mid={`${r.count} purchases`} right={`$${(r.rev/100).toFixed(2)}`} />
            ))}
          </Section>

          <Section title="User segments">
            {analytics.segments.map((s: any) => (
              <Row key={s.segment} left={SEG_LABEL[s.segment] || s.segment} mid="" right={String(s.count)} />
            ))}
          </Section>
        </div>
      )}
    </div>
  );
}

const StatCard = ({ icon: Icon, label, value }: any) => (
  <div className="bg-card border border-border rounded-2xl p-3">
    <Icon size={14} className="text-electric-purple mb-1" />
    <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    <p className="text-xl font-display font-bold">{value}</p>
  </div>
);
const Section = ({ title, children }: any) => (
  <div className="bg-card border border-border rounded-2xl p-4">
    <h3 className="font-display font-bold text-sm mb-3">{title}</h3>
    <div className="space-y-1.5">{children}</div>
  </div>
);
const Row = ({ left, mid, right }: any) => (
  <div className="flex items-center justify-between text-xs py-1.5 border-b border-border/40 last:border-0">
    <span className="font-semibold">{left}</span>
    <span className="text-muted-foreground">{mid}</span>
    <span className="font-bold text-gradient-electric">{right}</span>
  </div>
);
const Empty = () => <p className="text-xs text-muted-foreground text-center py-3">No data yet.</p>;
