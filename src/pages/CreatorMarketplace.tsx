import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { readFailed } from "@/lib/dbRead";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Star, ShoppingBag, Plus } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import CoachPlanCard from "@/components/coach/CoachPlanCard";
import { COACH_COMMISSION_PERCENT } from "@/config/coachMarketplace";

interface Listing {
  // Required, not optional: a row always has these columns (the table's default is
  // null), and `description?: string` is what stopped a Listing being usable as a
  // CoachPlan — an absent property is not the same type as one that is null.
  id: string; creator_id: string; title: string; description: string | null;
  category: string; price_cents: number; duration_minutes: number | null;
  cover_url: string | null; rating: number | null; sales_count: number;
  // Added for the coach marketplace. A coach plan is a listing with a duration in
  // weeks and its own currency; everything else in this table is a program or a
  // guide that no purchase path prices yet.
  is_coach_plan: boolean; weeks: number | null; currency: string; active: boolean;
}

const CATEGORIES = ["all", "plan", "program", "meal_plan", "session", "guide"];

export default function CreatorMarketplace() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listings, setListings] = useState<Listing[]>([]);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");
  const [sort, setSort] = useState<"new" | "popular" | "price">("popular");
  const [loading, setLoading] = useState(true);

  // "No listings yet" reads as "the marketplace is empty", which is not what a
  // failed read means.
  const [listFailed, setListFailed] = useState(false);

  // useCallback rather than an inline async body: the buy flow re-reads the list
  // after a purchase so the sales count is current, and that means the loader is
  // referenced from two places. A bare function recreated each render would make
  // the effect below re-run on every render.
  const load = useCallback(async () => {
    const { data, error } = await supabase.from("marketplace_listings").select("*").eq("active", true);
    setListFailed(readFailed(error, "the marketplace"));
    setListings((data || []) as Listing[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = listings
    .filter((l) => cat === "all" || l.category === cat)
    .filter((l) => !query || l.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      if (sort === "popular") return b.sales_count - a.sales_count;
      if (sort === "price") return a.price_cents - b.price_cents;
      return 0;
    });

  const notPurchasable = (l: Listing) => {
    // Only a coaching plan has a purchase path. A program or a guide published by
    // a creator has no price the server will honour, so the honest answer is that
    // it cannot be bought — rather than a checkout that fails somewhere later.
    toast.info(`"${l.title}" isn't purchasable yet — coaching plans are.`);
  };

  return (
    <div className="px-5 pt-[var(--vaylo-screen-top)] pb-24 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-4 gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><ShoppingBag className="h-6 w-6 text-electric-purple" /> Marketplace</h1>
          <p className="text-sm text-muted-foreground mt-1">Programs, meal plans, and 1-on-1 sessions from verified coaches.</p>
        </div>
        <Button onClick={() => navigate("/market/become-creator")} variant="outline">
          <Plus className="h-4 w-4 mr-1" /> Become a creator
        </Button>
      </div>

      <div className="flex gap-2 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search programs, meal plans, coaches…" className="pl-9 h-11" />
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as "new" | "popular" | "price")} className="h-11 px-3 rounded-md bg-card border border-border text-sm">
          <option value="popular">Popular</option>
          <option value="new">Newest</option>
          <option value="price">Price ↑</option>
        </select>
      </div>

      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {CATEGORIES.map((c) => (
          <button key={c} onClick={() => setCat(c)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition ${cat === c ? "bg-electric-purple text-white" : "bg-card border border-border text-muted-foreground"}`}>
            {c.replace("_", " ")}
          </button>
        ))}
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> :
       filtered.length === 0 ? (
        <div className="p-12 rounded-3xl border border-border bg-card text-center">
          <ShoppingBag className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">{listFailed ? "Could not load the listings" : "No listings yet"}</p>
          <p className="text-sm text-muted-foreground mt-1">
            {listFailed
              ? "This is a loading problem, not an empty marketplace — reopen this screen in a moment."
              : "Be one of the first creators to publish a program."}
          </p>
          {!listFailed && (
            <Button onClick={() => navigate("/market/become-creator")} className="mt-4">Become a creator</Button>
          )}
        </div>
       ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((l, i) =>
            // A coaching plan has a price the server honours and a buyer flow to
            // go with it. Anything else in this table is a creator's program or
            // guide with no purchase path, and is rendered as a card that says so.
            l.is_coach_plan ? (
              <CoachPlanCard key={l.id} plan={l} onBought={() => void load()} />
            ) : (
            <motion.div
              key={l.id}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="rounded-2xl border border-border bg-card overflow-hidden hover:border-electric-purple/40 transition"
            >
              <div className="aspect-video bg-gradient-to-br from-electric-purple/40 to-energy/20" style={l.cover_url ? { backgroundImage: `url(${l.cover_url})`, backgroundSize: "cover" } : {}} />
              <div className="p-4">
                <p className="text-[12px] uppercase tracking-wider text-electric-purple font-semibold">{l.category}</p>
                <h3 className="font-semibold mt-1 line-clamp-1">{l.title}</h3>
                {l.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{l.description}</p>}
                <div className="flex items-center justify-between mt-3">
                  <div className="text-lg font-bold">${(l.price_cents / 100).toFixed(2)}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1"><Star className="h-3 w-3 text-energy" /> {l.rating?.toFixed(1) ?? "—"}</div>
                </div>
                <Button onClick={() => notPurchasable(l)} variant="outline" className="w-full mt-3 h-10">
                  Not for sale yet
                </Button>
              </div>
            </motion.div>
            )
          )}
        </div>
       )}

      <p className="text-[12px] text-muted-foreground mt-6 text-center">
        Coaches set their own prices. You pay that price plus Vaylo's {COACH_COMMISSION_PERCENT}%
        fee, and the coach receives exactly what they asked for.
      </p>
      <p className="text-[12px] text-muted-foreground mt-2 text-center">
        Are you a coach?{" "}
        <Link to="/coach-studio" className="underline">
          Set your prices in the coach studio
        </Link>
        .
      </p>
    </div>
  );
}
