import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Star, Filter, ShoppingBag, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface Listing {
  id: string; creator_id: string; title: string; description?: string;
  category: string; price_cents: number; duration_minutes?: number;
  cover_url?: string; rating?: number; sales_count: number;
}

const CATEGORIES = ["all", "program", "meal_plan", "session", "guide"];

export default function CreatorMarketplace() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [listings, setListings] = useState<Listing[]>([]);
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");
  const [sort, setSort] = useState<"new" | "popular" | "price">("popular");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const q = supabase.from("marketplace_listings").select("*").eq("active", true);
      const { data } = await q;
      setListings((data || []) as Listing[]);
      setLoading(false);
    })();
  }, []);

  const filtered = listings
    .filter((l) => cat === "all" || l.category === cat)
    .filter((l) => !query || l.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      if (sort === "popular") return b.sales_count - a.sales_count;
      if (sort === "price") return a.price_cents - b.price_cents;
      return 0;
    });

  const buy = async (l: Listing) => {
    // Payments are not connected yet — say so plainly instead of faking a purchase.
    toast.info(`Checkout isn't live yet — ${l.title} can't be bought today.`);
  };

  return (
    <div className="px-5 pt-8 pb-24 max-w-5xl mx-auto">
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
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-11 px-3 rounded-md bg-card border border-border text-sm">
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
          <p className="font-medium">No listings yet</p>
          <p className="text-sm text-muted-foreground mt-1">Be one of the first creators to publish a program.</p>
          <Button onClick={() => navigate("/market/become-creator")} className="mt-4">Become a creator</Button>
        </div>
       ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((l, i) => (
            <motion.div
              key={l.id}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className="rounded-2xl border border-border bg-card overflow-hidden hover:border-electric-purple/40 transition"
            >
              <div className="aspect-video bg-gradient-to-br from-electric-purple/40 to-energy/20" style={l.cover_url ? { backgroundImage: `url(${l.cover_url})`, backgroundSize: "cover" } : {}} />
              <div className="p-4">
                <p className="text-[10px] uppercase tracking-wider text-electric-purple font-semibold">{l.category}</p>
                <h3 className="font-semibold mt-1 line-clamp-1">{l.title}</h3>
                {l.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{l.description}</p>}
                <div className="flex items-center justify-between mt-3">
                  <div className="text-lg font-bold">${(l.price_cents / 100).toFixed(2)}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1"><Star className="h-3 w-3 text-energy" /> {l.rating?.toFixed(1) ?? "—"}</div>
                </div>
                <Button onClick={() => buy(l)} className="w-full mt-3 h-10">Buy</Button>
              </div>
            </motion.div>
          ))}
        </div>
       )}

      <p className="text-[10px] text-muted-foreground mt-6 text-center">Vaylo Sports charges a 20% platform fee on creator sales.</p>
    </div>
  );
}
