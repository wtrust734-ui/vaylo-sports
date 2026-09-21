import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Calendar, Star, Video, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatLocalPrice } from "@/lib/creditEconomy";

interface Coach { user_id: string; display_name: string; bio?: string; specialties?: string[]; verified?: boolean; }

export default function HumanCoaches({ currency = "USD" }: { currency?: string }) {
  const { user } = useAuth();
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any).from("creator_profiles").select("*");
      setCoaches((data || []) as Coach[]);
      if (user) {
        const { data: b } = await (supabase as any).from("coach_bookings").select("*").eq("client_id", user.id);
        setBookings(b || []);
      }
      setLoading(false);
    })();
  }, [user]);

  const book = async (coach: Coach, minutes: 30 | 60) => {
    if (!user) return;
    const starts_at = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const price_cents = minutes === 30 ? 4500 : 8000;
    const { error } = await (supabase as any).from("coach_bookings").insert({
      coach_id: coach.user_id, client_id: user.id, starts_at, duration_minutes: minutes,
      price_cents, status: "pending", video_link: `https://meet.vaylo.app/${crypto.randomUUID().slice(0, 8)}`,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Booked ${minutes}-min session with ${coach.display_name}`);
    const { data: b } = await (supabase as any).from("coach_bookings").select("*").eq("client_id", user.id);
    setBookings(b || []);
  };

  return (
    <div className="space-y-6">
      {bookings.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Your sessions</h3>
          <div className="space-y-2">
            {bookings.map((b) => (
              <div key={b.id} className="p-4 rounded-2xl border border-border bg-card flex items-center justify-between">
                <div>
                  <p className="font-medium">{new Date(b.starts_at).toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{b.duration_minutes} min · {b.status}</p>
                </div>
                {b.video_link && (
                  <a href={b.video_link} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline"><Video className="h-4 w-4 mr-1" /> Join</Button>
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Available coaches</h3>
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> :
         coaches.length === 0 ? (
          <div className="p-8 rounded-2xl border border-border bg-card text-center text-sm text-muted-foreground">
            No human coaches are taking bookings yet. Verified coaches are being onboarded — check back soon, or keep training with Vaylo Coach in the meantime.
          </div>
         ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {coaches.map((c, i) => (
              <motion.div key={c.user_id}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                className="p-5 rounded-2xl border border-border bg-card">
                <div className="flex items-center gap-3 mb-2">
                  <div className="h-12 w-12 rounded-full bg-gradient-to-br from-electric-purple to-energy flex items-center justify-center font-bold text-white">
                    {c.display_name?.[0] || "C"}
                  </div>
                  <div>
                    <p className="font-semibold flex items-center gap-1">{c.display_name}{c.verified && <Check className="h-3 w-3 text-energy" />}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Star className="h-3 w-3 text-energy" /> 4.9 · 120 sessions</p>
                  </div>
                </div>
                {c.bio && <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{c.bio}</p>}
                {c.specialties && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {c.specialties.slice(0, 3).map((s) => <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{s}</span>)}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="outline" onClick={() => book(c, 30)}><Calendar className="h-3 w-3 mr-1" /> 30 min · {formatLocalPrice(4500, currency)}</Button>
                  <Button size="sm" onClick={() => book(c, 60)}>60 min · {formatLocalPrice(8000, currency)}</Button>
                </div>
              </motion.div>
            ))}
          </div>
         )}
      </div>
    </div>
  );
}
