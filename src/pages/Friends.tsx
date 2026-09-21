import { useState, useEffect, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { Users, UserPlus, Copy, Check, Clock, X, Search, Gift, Share2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { publicAppUrl, shareContent } from "@/lib/share";

const Friends = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [myCode, setMyCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [friendCode, setFriendCode] = useState("");
  const [friends, setFriends] = useState<any[]>([]);
  const [pendingIn, setPendingIn] = useState<any[]>([]);
  const [pendingOut, setPendingOut] = useState<any[]>([]);
  const friendsRef = useRef(null);
  const friendsInView = useInView(friendsRef, { once: true, margin: "-30px" });

  useEffect(() => { if (user) { ensureCode(); fetchFriends(); fetchRequests(); } }, [user]);

  const ensureCode = async () => {
    if (!user) return;
    const { data, error } = await supabase.from("friend_codes").select("code").eq("user_id", user.id).maybeSingle();
    if (error) { toast({ title: "Couldn't load your friend code", description: error.message, variant: "destructive" }); return; }
    if (data) { setMyCode(data.code); return; }

    const code = "V-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    const { error: insertError } = await supabase.from("friend_codes").insert({ user_id: user.id, code });
    if (insertError) {
      // Already created on another device/tab — read it back rather than failing.
      const { data: existing } = await supabase.from("friend_codes").select("code").eq("user_id", user.id).maybeSingle();
      if (existing) { setMyCode(existing.code); return; }
      toast({ title: "Couldn't create your friend code", description: insertError.message, variant: "destructive" });
      return;
    }
    setMyCode(code);
  };

  const fetchFriends = async () => {
    if (!user) return;
    const { data } = await supabase.from("friendships").select("*").or(`user_id.eq.${user.id},friend_id.eq.${user.id}`);
    // Get profiles for friends
    const friendIds = (data || []).map(f => f.user_id === user.id ? f.friend_id : f.user_id);
    if (friendIds.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("user_id, full_name, sport, experience_level").in("user_id", friendIds);
      setFriends(profiles || []);
    } else {
      setFriends([]);
    }
  };

  const fetchRequests = async () => {
    if (!user) return;
    const { data: incoming } = await supabase.from("friend_requests").select("*").eq("to_user_id", user.id).eq("status", "pending");
    const { data: outgoing } = await supabase.from("friend_requests").select("*").eq("from_user_id", user.id).eq("status", "pending");
    // Get names for incoming
    const inIds = (incoming || []).map(r => r.from_user_id);
    if (inIds.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("user_id, full_name").in("user_id", inIds);
      setPendingIn((incoming || []).map(r => ({ ...r, name: profiles?.find(p => p.user_id === r.from_user_id)?.full_name || "Unknown" })));
    } else {
      setPendingIn([]);
    }
    setPendingOut(outgoing || []);
  };

  const sendRequest = async () => {
    if (!user || !friendCode.trim()) return;
    const code = friendCode.trim().toUpperCase();
    // Friend codes resolve server-side by exact match only — the table is no
    // longer readable in bulk by clients.
    const { data: foundUserId, error: lookupError } = await supabase.rpc("find_user_by_friend_code" as any, { p_code: code });
    if (lookupError) { toast({ title: "Lookup failed", description: lookupError.message, variant: "destructive" }); return; }
    if (!foundUserId) { toast({ title: "Code not found", variant: "destructive" }); return; }
    if (foundUserId === user.id) { toast({ title: "That's your own code!", variant: "destructive" }); return; }
    const { error } = await supabase.from("friend_requests").insert({ from_user_id: user.id, to_user_id: foundUserId });
    if (error?.code === "23505") { toast({ title: "Request already sent" }); return; }
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    setFriendCode("");
    fetchRequests();
    toast({ title: "Request sent! 🤝" });
  };

  const acceptRequest = async (req: any) => {
    if (!user) return;
    const { error: statusError } = await supabase.from("friend_requests").update({ status: "accepted" }).eq("id", req.id);
    if (statusError) { toast({ title: "Couldn't accept request", description: statusError.message, variant: "destructive" }); return; }

    // A friendship is two rows (one each direction). 23505 = already there.
    const links = [
      { user_id: user.id, friend_id: req.from_user_id },
      { user_id: req.from_user_id, friend_id: user.id },
    ];
    for (const link of links) {
      const { error } = await supabase.from("friendships").insert(link);
      if (error && error.code !== "23505") {
        toast({ title: "Accepted, but the friendship didn't save", description: error.message, variant: "destructive" });
        return;
      }
    }
    fetchFriends(); fetchRequests();
    toast({ title: "Friend added! 🎉" });
  };

  const declineRequest = async (req: any) => {
    const { error } = await supabase.from("friend_requests").update({ status: "declined" }).eq("id", req.id);
    if (error) { toast({ title: "Couldn't decline request", description: error.message, variant: "destructive" }); return; }
    fetchRequests();
  };

  const copyCode = () => {
    navigator.clipboard.writeText(myCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast({ title: "Code copied!" });
  };

  const inputClass = "w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all duration-300";

  return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-14 pb-4">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-display font-bold">Friends</motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="text-sm text-muted-foreground mt-1">Connect. Compete. Conquer.</motion.p>
      </div>

      {/* My Friend Code */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="mx-5 mb-5 bg-gradient-card border border-border rounded-2xl p-5 shadow-card text-center">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-primary mb-2">Your Friend Code</p>
        <motion.p className="text-2xl font-display font-bold tracking-widest text-primary mb-3"
          initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={{ type: "spring" }}>
          {myCode || "..."}
        </motion.p>
        <motion.button onClick={copyCode} whileTap={{ scale: 0.95 }}
          className="bg-primary/10 text-primary text-sm font-semibold px-4 py-2 rounded-xl flex items-center gap-2 mx-auto">
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied!" : "Copy Code"}
        </motion.button>
      </motion.div>

      {/* Refer & Earn */}
      <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="mx-5 mb-5 bg-gradient-card border border-electric-purple/30 rounded-2xl p-4 shadow-card">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-9 h-9 rounded-xl bg-electric-purple/15 flex items-center justify-center">
            <Gift size={16} className="text-electric-purple" />
          </div>
          <div>
            <p className="text-sm font-display font-bold">Refer & Earn</p>
            <p className="text-[11px] text-muted-foreground">Earn 3 credits per friend who hits a 5-day streak</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 my-3">
          <div className="bg-muted/40 rounded-xl p-2.5 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Referred</p>
            <p className="text-xl font-display font-bold text-electric-purple">{friends.length}</p>
          </div>
          <div className="bg-muted/40 rounded-xl p-2.5 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Credits Earned</p>
            <p className="text-xl font-display font-bold text-energy">{friends.length * 3}</p>
          </div>
        </div>
        <motion.button whileTap={{ scale: 0.97 }} onClick={() => {
          const link = publicAppUrl(`/auth?ref=${myCode}`);
          void shareContent({ title: "Join me on Vaylo Sports", text: "Train with me on Vaylo Sports", url: link })
            .then((result) => {
              if (result === "copied") toast({ title: "Referral link copied!" });
              if (result === "unsupported") toast({ title: "Referral link", description: link, variant: "destructive" });
            });
        }}
          className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-electric-purple to-primary text-primary-foreground font-semibold py-2.5 rounded-xl text-sm shadow-glow">
          <Share2 size={14} /> Share referral link
        </motion.button>
        <p className="text-[10px] text-muted-foreground mt-2 text-center">
          Reward auto-credits when your referral logs 5 days in a row.
        </p>
      </motion.div>



      {/* Add Friend */}
      <div className="px-5 mb-5">
        <div className="flex gap-2">
          <input type="text" placeholder="Enter friend code (e.g. V-ABC123)" value={friendCode} onChange={e => setFriendCode(e.target.value)}
            className={inputClass} />
          <motion.button onClick={sendRequest} disabled={!friendCode.trim()} whileTap={{ scale: 0.95 }}
            className="bg-gradient-primary text-primary-foreground px-4 rounded-xl font-semibold text-sm disabled:opacity-40 shadow-glow">
            <UserPlus size={18} />
          </motion.button>
        </div>
      </div>

      {/* Pending Requests */}
      {pendingIn.length > 0 && (
        <div className="px-5 mb-5">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-1"><Clock size={14} /> Incoming Requests</h3>
          <div className="space-y-2">
            {pendingIn.map((req, i) => (
              <motion.div key={req.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                className="bg-card border border-border rounded-xl p-3 flex items-center justify-between">
                <span className="text-sm font-semibold">{req.name}</span>
                <div className="flex gap-2">
                  <motion.button onClick={() => acceptRequest(req)} whileTap={{ scale: 0.9 }}
                    className="bg-primary/10 text-primary p-2 rounded-lg"><Check size={14} /></motion.button>
                  <motion.button onClick={() => declineRequest(req)} whileTap={{ scale: 0.9 }}
                    className="bg-destructive/10 text-destructive p-2 rounded-lg"><X size={14} /></motion.button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Friends List */}
      <div ref={friendsRef} className="px-5 mb-8">
        <h3 className="text-sm font-semibold text-muted-foreground mb-3">Your Friends ({friends.length})</h3>
        {friends.length === 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12">
            <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 2, repeat: Infinity }}>
              <Users size={48} className="mx-auto text-muted-foreground/30 mb-3" />
            </motion.div>
            <p className="text-sm text-muted-foreground">Share your friend code to connect with athletes!</p>
          </motion.div>
        )}
        <div className="space-y-3">
          {friends.map((f, i) => (
            <motion.div key={f.user_id} initial={{ opacity: 0, x: -15 }} animate={friendsInView ? { opacity: 1, x: 0 } : {}}
              transition={{ delay: i * 0.06 }}
              className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 hover:border-primary/20 transition-colors duration-300">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                <Users size={18} className="text-primary" />
              </div>
              <div>
                <h4 className="font-semibold text-sm">{f.full_name || "Athlete"}</h4>
                <p className="text-xs text-muted-foreground">{f.sport || "Multi-sport"} · {f.experience_level || "—"}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Friends;
