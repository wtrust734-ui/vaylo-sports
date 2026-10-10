import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Calendar, Star, Video, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { readFailed } from "@/lib/dbRead";
import { formatDateTimeExact } from "@/i18n/format";

interface Coach { user_id: string; display_name: string; bio?: string; specialties?: string[]; verified?: boolean; }

export default function HumanCoaches() {
  const { user } = useAuth();
  const [coaches, setCoaches] = useState<Coach[]>([]);
  type CoachBooking = {
    id: string;
    starts_at: string;
    duration_minutes: number;
    status: string;
    video_link: string | null;
  };
  const [bookings, setBookings] = useState<CoachBooking[]>([]);
  const [loading, setLoading] = useState(true);
  // A read failure is not "no coaches are taking bookings". That sentence is a
  // claim about the marketplace, and it is the one an athlete reads as fact.
  const [listFailed, setListFailed] = useState(false);

  useEffect(() => {
    (async () => {
      // Explicit columns: since the 2026-10-06 audit migration, SELECT on
      // creator_profiles is column-scoped and payout_email is unreadable by
      // clients — select("*") would now fail with permission denied.
      const { data, error } = await supabase
        .from("creator_profiles")
        .select("user_id, display_name, bio, specialties, verified");
      setListFailed(readFailed(error, "the coach list"));
      setCoaches((data || []) as Coach[]);
      if (user) {
        const { data: b, error: bookingsError } = await supabase.from("coach_bookings").select("*").eq("client_id", user.id);
        readFailed(bookingsError, "your booked sessions");
        setBookings(b || []);
      }
      setLoading(false);
    })();
  }, [user]);

  const [booking, setBooking] = useState<string | null>(null);
  const book = async (coach: Coach, minutes: 30 | 60) => {
    if (!user || booking) return;
    const starts_at = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    setBooking(coach.user_id);
    const { error } = await supabase.from("coach_bookings").insert({
      coach_id: coach.user_id, client_id: user.id, starts_at, duration_minutes: minutes,
      status: "pending",
      // price_cents and video_link are deliberately NOT sent: the server
      // trigger nulls/zeroes them (platform prices and provisions sessions;
      // the marketplace is pre-payment).
    });
    setBooking(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`Requested ${minutes}-min session with ${coach.display_name}`);
    const { data: b, error: refreshError } = await supabase.from("coach_bookings").select("*").eq("client_id", user.id);
    // The booking itself landed; only the list behind it failed to refresh.
    readFailed(refreshError, "your booked sessions");
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
                  <p className="font-medium">{formatDateTimeExact(b.starts_at)}</p>
                  <p className="text-xs text-muted-foreground">{b.duration_minutes} min · {b.status}</p>
                </div>
                {b.video_link && (
                  <a href={b.video_link} target="_blank" rel="noreferrer noopener">
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
         listFailed ? (
          <div className="p-8 rounded-2xl border border-border bg-card text-center text-sm text-muted-foreground">
            We couldn't load the coach list just now — this looks like a connection problem rather than an empty
            marketplace. Reload the screen to try again.
          </div>
         ) :
         coaches.length === 0 ? (
          <div className="p-8 rounded-2xl border border-border bg-card text-center text-sm text-muted-foreground">
            No human coaches are taking bookings yet. Verified coaches are being onboarded — check back soon, or keep training with Vaylo Sports Coach in the meantime.
          </div>
         ) : (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
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
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Star className="h-3 w-3 text-energy" /> New coach</p>
                  </div>
                </div>
                {c.bio && <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{c.bio}</p>}
                {c.specialties && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {c.specialties.slice(0, 3).map((s) => <span key={s} className="text-[12px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{s}</span>)}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="outline" disabled={booking === c.user_id} onClick={() => book(c, 30)}><Calendar className="h-3 w-3 mr-1" /> 30 min</Button>
                  <Button size="sm" disabled={booking === c.user_id} onClick={() => book(c, 60)}>60 min</Button>
                </div>
                <p className="text-[12px] text-muted-foreground mt-2">
                  Sessions are free to request while checkout is being built —
                  pricing and payment arrive with the marketplace launch.
                </p>
              </motion.div>
            ))}
          </div>
         )}
      </div>
    </div>
  );
}
