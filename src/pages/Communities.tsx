import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, Plus, Crown, Shield, Bell, BellOff, Lock, Globe, TrendingUp, Sparkles, X, Pin, Search, UserPlus, LogOut, MessageSquare, Settings } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

type Community = {
  id: string; owner_id: string; name: string; description: string | null;
  sport: string | null; emoji: string; privacy: string; member_count: number; trending_score: number;
};
type Member = { id: string; user_id: string; role: string; notifications_enabled: boolean; community_id: string };
type Privacy = { allow_friend_requests: boolean; group_visibility: string; allow_community_posting: boolean; show_avatar_publicly: boolean };

const ROLE_ICON: Record<string, any> = { leader: Crown, moderator: Shield, member: Users };
const PRIVACY_OPTS = [
  { value: "public", label: "Public", icon: Globe },
  { value: "private", label: "Private", icon: Lock },
  { value: "invite", label: "Invite Only", icon: UserPlus },
];

const Communities = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [tab, setTab] = useState<"my" | "explore" | "privacy">("my");
  const [communities, setCommunities] = useState<Community[]>([]);
  const [myMemberships, setMyMemberships] = useState<Member[]>([]);
  const [trending, setTrending] = useState<Community[]>([]);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [addFriend, setAddFriend] = useState(false);
  const [friendCode, setFriendCode] = useState("");
  const [myCode, setMyCode] = useState("");
  const [activeGroup, setActiveGroup] = useState<Community | null>(null);
  const [privacy, setPrivacy] = useState<Privacy>({
    allow_friend_requests: true, group_visibility: "public",
    allow_community_posting: true, show_avatar_publicly: true,
  });

  // Create form
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newSport, setNewSport] = useState("");
  const [newEmoji, setNewEmoji] = useState("🏆");
  const [newPrivacy, setNewPrivacy] = useState("public");

  useEffect(() => { if (user) { loadAll(); } }, [user]);

  const loadAll = async () => {
    if (!user) return;
    const [{ data: mems }, { data: trend }, { data: priv }, { data: code }] = await Promise.all([
      supabase.from("community_members").select("*").eq("user_id", user.id),
      supabase.from("communities").select("*").order("trending_score", { ascending: false }).limit(20),
      supabase.from("privacy_settings").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("friend_codes").select("code").eq("user_id", user.id).maybeSingle(),
    ]);
    setMyMemberships(mems || []);
    setTrending(trend || []);
    if (mems && mems.length > 0) {
      const ids = mems.map(m => m.community_id);
      const { data: comms } = await supabase.from("communities").select("*").in("id", ids);
      setCommunities(comms || []);
    } else setCommunities([]);
    if (priv) setPrivacy(priv as Privacy);
    if (code) setMyCode(code.code);
    else {
      const newCode = "V-" + Math.random().toString(36).substring(2, 8).toUpperCase();
      const { error } = await supabase.from("friend_codes").insert({ user_id: user.id, code: newCode });
      if (error) {
        // Already created elsewhere — read it back instead of showing a stale code.
        const { data: existing } = await supabase.from("friend_codes").select("code").eq("user_id", user.id).maybeSingle();
        if (existing) setMyCode(existing.code);
        else toast({ title: "Couldn't create your friend code", description: error.message, variant: "destructive" });
        return;
      }
      setMyCode(newCode);
    }
  };

  const createCommunity = async () => {
    if (!user || !newName.trim()) return;
    const { data, error } = await supabase.from("communities").insert({
      owner_id: user.id, name: newName.trim(), description: newDesc.trim() || null,
      sport: newSport.trim() || null, emoji: newEmoji, privacy: newPrivacy,
    }).select().single();
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Community launched! 🚀" });
    setCreating(false); setNewName(""); setNewDesc(""); setNewSport(""); setNewEmoji("🏆"); setNewPrivacy("public");
    loadAll();
    if (data) setActiveGroup(data as Community);
  };

  const joinCommunity = async (c: Community) => {
    if (!user) return;
    const { error } = await supabase.from("community_members").insert({ community_id: c.id, user_id: user.id });
    if (error) { toast({ title: "Couldn't join", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Joined ${c.name}! 🎉` });
    loadAll();
  };

  const leaveCommunity = async (c: Community) => {
    if (!user) return;
    const { error } = await supabase.from("community_members").delete().eq("community_id", c.id).eq("user_id", user.id);
    if (error) { toast({ title: "Couldn't leave the community", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Left ${c.name}` });
    setActiveGroup(null);
    loadAll();
  };

  const toggleNotif = async (c: Community, current: boolean) => {
    if (!user) return;
    const { error } = await supabase.from("community_members").update({ notifications_enabled: !current })
      .eq("community_id", c.id).eq("user_id", user.id);
    if (error) { toast({ title: "Couldn't change notifications", description: error.message, variant: "destructive" }); return; }
    toast({ title: !current ? "Notifications on" : "Notifications muted" });
    loadAll();
  };

  const sendFriendRequest = async () => {
    if (!user || !friendCode.trim()) return;
    const code = friendCode.trim().toUpperCase();
    // Server-side exact-match lookup — friend codes are not enumerable by clients.
    const { data: foundUserId, error: lookupError } = await supabase.rpc("find_user_by_friend_code", { p_code: code });
    if (lookupError) { toast({ title: "Lookup failed", description: lookupError.message, variant: "destructive" }); return; }
    if (!foundUserId) { toast({ title: "Code not found", variant: "destructive" }); return; }
    if (foundUserId === user.id) { toast({ title: "That's your code!", variant: "destructive" }); return; }
    // Check recipient's privacy
    const { data: recipPriv } = await supabase.from("privacy_settings")
      .select("allow_friend_requests").eq("user_id", foundUserId).maybeSingle();
    if (recipPriv && !recipPriv.allow_friend_requests) {
      toast({ title: "This athlete isn't accepting requests", variant: "destructive" }); return;
    }
    const { error } = await supabase.from("friend_requests").insert({ from_user_id: user.id, to_user_id: foundUserId });
    if (error?.code === "23505") { toast({ title: "Request already sent" }); return; }
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Friend request sent! 🤝" });
    setFriendCode(""); setAddFriend(false);
  };

  const savePrivacy = async (patch: Partial<Privacy>) => {
    if (!user) return;
    const next = { ...privacy, ...patch };
    setPrivacy(next);
    const { data: existing } = await supabase.from("privacy_settings").select("id").eq("user_id", user.id).maybeSingle();
    const { error } = existing
      ? await supabase.from("privacy_settings").update(next).eq("user_id", user.id)
      : await supabase.from("privacy_settings").insert({ user_id: user.id, ...next });
    if (error) {
      setPrivacy(privacy); // roll the optimistic update back
      toast({ title: "Couldn't save privacy settings", description: error.message, variant: "destructive" });
      return;
    }
  };

  const myMembership = (cid: string) => myMemberships.find(m => m.community_id === cid);
  const filtered = trending.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.sport || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="px-5 pt-14 pb-4 flex items-start justify-between">
        <div>
          <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="text-2xl font-display font-bold">Communities</motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}
            className="text-sm text-muted-foreground mt-1">Squad up. Build pride. Win together.</motion.p>
        </div>
        <motion.button whileTap={{ scale: 0.92 }} onClick={() => setAddFriend(true)}
          className="flex items-center gap-1.5 bg-gradient-primary text-primary-foreground px-3 py-2 rounded-xl text-xs font-semibold shadow-glow">
          <UserPlus size={14} /> Add Friend
        </motion.button>
      </div>

      {/* Tabs */}
      <div className="px-5 mb-5 flex gap-2">
        {(["my", "explore", "privacy"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold capitalize transition-all ${
              tab === t ? "bg-gradient-primary text-primary-foreground shadow-glow" : "bg-card border border-border text-muted-foreground"
            }`}>
            {t === "my" ? "My Groups" : t}
          </button>
        ))}
      </div>

      {/* MY GROUPS */}
      {tab === "my" && (
        <div className="px-5 space-y-3">
          <motion.button whileTap={{ scale: 0.97 }} onClick={() => setCreating(true)}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-primary/40 text-primary text-sm font-semibold hover:bg-primary/5 transition-all">
            <Plus size={16} /> Create New Community
          </motion.button>

          {communities.length === 0 && (
            <div className="text-center py-12">
              <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 2, repeat: Infinity }}>
                <Sparkles size={48} className="mx-auto text-muted-foreground/30 mb-3" />
              </motion.div>
              <p className="text-sm text-muted-foreground">Join or create a group to start your tribe.</p>
            </div>
          )}

          {communities.map((c, i) => {
            const m = myMembership(c.id);
            const RoleIcon = ROLE_ICON[m?.role || "member"];
            return (
              <motion.div key={c.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                onClick={() => setActiveGroup(c)}
                className="bg-gradient-card border border-border rounded-2xl p-4 shadow-card cursor-pointer hover:border-primary/30 transition-all">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center text-2xl">{c.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-display font-bold truncate">{c.name}</h3>
                      <RoleIcon size={12} className="text-primary shrink-0" />
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{c.sport || "Multi-sport"} · {c.member_count} members</p>
                  </div>
                  {m?.notifications_enabled ? <Bell size={14} className="text-primary" /> : <BellOff size={14} className="text-muted-foreground" />}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* EXPLORE */}
      {tab === "explore" && (
        <div className="px-5 space-y-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search trending groups..."
              className="w-full bg-card border border-border rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
            <TrendingUp size={12} className="text-primary" /> Trending now
          </div>
          {filtered.map((c, i) => {
            const joined = !!myMembership(c.id);
            return (
              <motion.div key={c.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
                className="bg-card border border-border rounded-2xl p-4 flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center text-2xl">{c.emoji}</div>
                <div className="flex-1 min-w-0" onClick={() => setActiveGroup(c)}>
                  <h3 className="font-semibold text-sm truncate">{c.name}</h3>
                  <p className="text-xs text-muted-foreground truncate">{c.sport || "Multi-sport"} · {c.member_count} members</p>
                </div>
                {joined ? (
                  <span className="text-[10px] font-bold text-primary px-2 py-1 rounded-full bg-primary/10">JOINED</span>
                ) : (
                  <motion.button whileTap={{ scale: 0.92 }} onClick={() => joinCommunity(c)}
                    className="text-xs font-semibold bg-gradient-primary text-primary-foreground px-3 py-1.5 rounded-lg shadow-glow">
                    Join
                  </motion.button>
                )}
              </motion.div>
            );
          })}
          {filtered.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-12">No groups found. Be the first to create one!</p>
          )}
        </div>
      )}

      {/* PRIVACY */}
      {tab === "privacy" && (
        <div className="px-5 space-y-3">
          <div className="bg-gradient-card border border-border rounded-2xl p-4 shadow-card">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary mb-1">Your Friend Code</p>
            <p className="text-xl font-display font-bold tracking-widest text-primary">{myCode || "..."}</p>
          </div>
          {[
            { key: "allow_friend_requests", label: "Allow friend requests", desc: "Athletes can send you requests via your code" },
            { key: "allow_community_posting", label: "Allow community posting", desc: "Let groups invite you to post" },
            { key: "show_avatar_publicly", label: "Show avatar publicly", desc: "Display your avatar in groups before friending" },
          ].map(opt => (
            <div key={opt.key} className="bg-card border border-border rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">{opt.label}</p>
                <p className="text-xs text-muted-foreground">{opt.desc}</p>
              </div>
              <button onClick={() => savePrivacy({ [opt.key]: !privacy[opt.key] })}
                className={`w-11 h-6 rounded-full transition-all relative ${privacy[opt.key] ? "bg-primary" : "bg-muted"}`}>
                <motion.div layout className={`absolute top-0.5 w-5 h-5 bg-background rounded-full shadow ${privacy[opt.key] ? "right-0.5" : "left-0.5"}`} />
              </button>
            </div>
          ))}
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-sm font-semibold mb-2">Group visibility</p>
            <p className="text-xs text-muted-foreground mb-3">Who can see the groups you've joined</p>
            <div className="flex gap-2">
              {["public", "friends", "private"].map(v => (
                <button key={v} onClick={() => savePrivacy({ group_visibility: v })}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold capitalize transition-all ${
                    privacy.group_visibility === v ? "bg-gradient-primary text-primary-foreground shadow-glow" : "bg-muted text-muted-foreground"
                  }`}>{v}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ADD FRIEND modal */}
      <AnimatePresence>
        {addFriend && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex items-end sm:items-center justify-center p-4"
            onClick={() => setAddFriend(false)}>
            <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-card border border-border rounded-3xl p-6 w-full max-w-md shadow-card">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-bold text-lg">Add Friend</h3>
                <button onClick={() => setAddFriend(false)} className="text-muted-foreground"><X size={20} /></button>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Your code</p>
              <div className="bg-primary/10 rounded-xl p-3 text-center mb-4">
                <p className="text-xl font-display font-bold tracking-widest text-primary">{myCode || "..."}</p>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Enter their friend code</p>
              <input value={friendCode} onChange={e => setFriendCode(e.target.value)} placeholder="V-ABC123"
                className="w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-primary/50" />
              <motion.button whileTap={{ scale: 0.97 }} onClick={sendFriendRequest} disabled={!friendCode.trim()}
                className="w-full bg-gradient-primary text-primary-foreground py-3 rounded-xl font-semibold text-sm disabled:opacity-40 shadow-glow">
                Send Request
              </motion.button>
              <button onClick={() => { setAddFriend(false); navigate("/friends"); }}
                className="w-full mt-2 text-xs text-muted-foreground py-2">Manage all friends →</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CREATE modal */}
      <AnimatePresence>
        {creating && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-background/80 backdrop-blur-md z-50 flex items-end sm:items-center justify-center p-4"
            onClick={() => setCreating(false)}>
            <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="bg-card border border-border rounded-3xl p-6 w-full max-w-md shadow-card max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-display font-bold text-lg">Create Community</h3>
                <button onClick={() => setCreating(false)} className="text-muted-foreground"><X size={20} /></button>
              </div>
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input value={newEmoji} onChange={e => setNewEmoji(e.target.value.slice(0, 2))} maxLength={2}
                    className="w-16 bg-muted border border-border rounded-xl px-3 py-2.5 text-center text-2xl" />
                  <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Squad name"
                    className="flex-1 bg-muted border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                </div>
                <input value={newSport} onChange={e => setNewSport(e.target.value)} placeholder="Sport (optional)"
                  className="w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="What's your mission?" rows={3}
                  className="w-full bg-muted border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none" />
                <div>
                  <p className="text-xs text-muted-foreground mb-2">Privacy</p>
                  <div className="flex gap-2">
                    {PRIVACY_OPTS.map(p => (
                      <button key={p.value} onClick={() => setNewPrivacy(p.value)}
                        className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition-all ${
                          newPrivacy === p.value ? "bg-gradient-primary text-primary-foreground shadow-glow" : "bg-muted text-muted-foreground"
                        }`}>
                        <p.icon size={12} /> {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <motion.button whileTap={{ scale: 0.97 }} onClick={createCommunity} disabled={!newName.trim()}
                  className="w-full bg-gradient-primary text-primary-foreground py-3 rounded-xl font-semibold text-sm disabled:opacity-40 shadow-glow">
                  Launch Community
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* GROUP DETAIL drawer */}
      <AnimatePresence>
        {activeGroup && (
          <GroupDetail
            community={activeGroup}
            membership={myMembership(activeGroup.id)}
            onClose={() => setActiveGroup(null)}
            onJoin={() => joinCommunity(activeGroup)}
            onLeave={() => leaveCommunity(activeGroup)}
            onToggleNotif={() => myMembership(activeGroup.id) && toggleNotif(activeGroup, myMembership(activeGroup.id)!.notifications_enabled)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

const GroupDetail = ({ community, membership, onClose, onJoin, onLeave, onToggleNotif }: {
  community: Community; membership?: Member; onClose: () => void;
  onJoin: () => void; onLeave: () => void; onToggleNotif: () => void;
}) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [members, setMembers] = useState<any[]>([]);
  const [posts, setPosts] = useState<any[]>([]);
  const [pinned, setPinned] = useState<any[]>([]);
  const [newPost, setNewPost] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => { load(); }, [community.id]);

  const load = async () => {
    const [{ data: mems }, { data: ps }, { data: pin }] = await Promise.all([
      supabase.from("community_members").select("*").eq("community_id", community.id).limit(50),
      supabase.from("community_posts").select("*").eq("community_id", community.id).order("created_at", { ascending: false }).limit(20),
      supabase.from("community_pinned_avatars").select("*").eq("community_id", community.id).order("position"),
    ]);
    const userIds = [...new Set([...(mems || []).map((m: any) => m.user_id), ...(pin || []).map((p: any) => p.user_id)])];
    const profileMap: Record<string, any> = {};
    const avatarMap: Record<string, any> = {};
    if (userIds.length > 0) {
      // One query, against the only cross-user table the schema grants to every
      // athlete. The old extra `profiles` lookup was self-read-only, so it always
      // came back empty and members/posts/pins fell back to "Athlete". The public
      // name lives on `avatars.display_name`; keep the profileMap shape so the
      // render code (profile?.full_name) stays untouched.
      const { data: avs } = await supabase
        .from("avatars")
        .select("user_id, display_name, base, headgear, outfit, badge")
        .in("user_id", userIds);
      (avs || []).forEach((a: any) => {
        avatarMap[a.user_id] = a;
        profileMap[a.user_id] = { user_id: a.user_id, full_name: a.display_name };
      });
    }
    setMembers((mems || []).map((m: any) => ({ ...m, profile: profileMap[m.user_id], avatar: avatarMap[m.user_id] })));
    setPosts((ps || []).map((p: any) => ({ ...p, profile: profileMap[p.user_id] })));
    setPinned((pin || []).map((p: any) => ({ ...p, avatar: avatarMap[p.user_id], profile: profileMap[p.user_id] })));
  };

  const post = async () => {
    if (!user || !newPost.trim()) return;
    const { error } = await supabase.from("community_posts").insert({ community_id: community.id, user_id: user.id, content: newPost.trim() });
    if (error) { toast({ title: "Couldn't post", description: error.message, variant: "destructive" }); return; }
    setNewPost(""); load();
  };

  const pinMe = async () => {
    if (!user) return;
    const { error } = await supabase.from("community_pinned_avatars").insert({ community_id: community.id, user_id: user.id });
    if (error?.code === "23505") { toast({ title: "Already pinned" }); return; }
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Avatar pinned ⭐" }); load();
  };

  const unpinMe = async () => {
    if (!user) return;
    const { error } = await supabase.from("community_pinned_avatars").delete().eq("community_id", community.id).eq("user_id", user.id);
    if (error) { toast({ title: "Couldn't unpin your avatar", description: error.message, variant: "destructive" }); return; }
    load();
  };

  const setRole = async (memberId: string, role: string) => {
    if (!user || community.owner_id !== user.id) return;
    const { error } = await supabase.from("community_members").update({ role }).eq("id", memberId);
    if (error) { toast({ title: "Couldn't change that role", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Role set to ${role}` }); load();
  };

  const isOwner = user?.id === community.owner_id;
  const meMembership = members.find(m => m.user_id === user?.id);
  const meIsPinned = pinned.some(p => p.user_id === user?.id);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background/85 backdrop-blur-md z-50 flex items-end justify-center"
      onClick={onClose}>
      <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 32 }}
        onClick={e => e.stopPropagation()}
        className="bg-card border-t border-border w-full max-w-2xl rounded-t-3xl max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-card/95 backdrop-blur-xl border-b border-border p-5 flex items-center gap-3 z-10">
          <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center text-3xl">{community.emoji}</div>
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-bold text-lg truncate">{community.name}</h2>
            <p className="text-xs text-muted-foreground">{community.sport || "Multi-sport"} · {community.member_count} members · {community.privacy}</p>
          </div>
          {membership && (
            <button onClick={onToggleNotif} className="p-2 rounded-lg bg-muted">
              {membership.notifications_enabled ? <Bell size={16} className="text-primary" /> : <BellOff size={16} className="text-muted-foreground" />}
            </button>
          )}
          <button onClick={onClose} className="p-2 text-muted-foreground"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-5">
          {community.description && <p className="text-sm text-muted-foreground">{community.description}</p>}

          {!membership && (
            <motion.button whileTap={{ scale: 0.97 }} onClick={onJoin}
              className="w-full bg-gradient-primary text-primary-foreground py-3 rounded-xl font-semibold text-sm shadow-glow">
              Join Community
            </motion.button>
          )}

          {/* Pinned avatars */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Pin size={12} /> Pinned Avatars
              </h4>
              {membership && (
                <button onClick={meIsPinned ? unpinMe : pinMe} className="text-[10px] font-bold text-primary">
                  {meIsPinned ? "UNPIN ME" : "PIN ME"}
                </button>
              )}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {pinned.length === 0 && <p className="text-xs text-muted-foreground">No pinned avatars yet.</p>}
              {pinned.map(p => (
                <div key={p.id} className="shrink-0 w-20 text-center">
                  <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-card border border-primary/20 flex items-center justify-center text-2xl">
                    {p.avatar?.headgear ? "🎩" : "🏃"}
                  </div>
                  <p className="text-[10px] mt-1 truncate">{p.avatar?.display_name || p.profile?.full_name || "Athlete"}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Recent activity (posts) */}
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
              <MessageSquare size={12} /> Recent Activity
            </h4>
            {membership && (
              <div className="flex gap-2 mb-3">
                <input value={newPost} onChange={e => setNewPost(e.target.value)} placeholder="Share an update..."
                  className="flex-1 bg-muted border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                <motion.button whileTap={{ scale: 0.95 }} onClick={post} disabled={!newPost.trim()}
                  className="bg-gradient-primary text-primary-foreground px-4 rounded-xl font-semibold text-xs disabled:opacity-40 shadow-glow">
                  Post
                </motion.button>
              </div>
            )}
            <div className="space-y-2">
              {posts.length === 0 && <p className="text-xs text-muted-foreground">No activity yet. Be the first!</p>}
              {posts.map(p => (
                <div key={p.id} className="bg-muted/30 border border-border rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold">{p.profile?.full_name || "Athlete"}</span>
                    <span className="text-[10px] text-muted-foreground">{new Date(p.created_at).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm">{p.content}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Members + roles */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Users size={12} /> Members ({members.length})
              </h4>
              {isOwner && (
                <button onClick={() => setShowSettings(s => !s)} className="text-[10px] font-bold text-primary flex items-center gap-1">
                  <Settings size={12} /> {showSettings ? "DONE" : "MANAGE"}
                </button>
              )}
            </div>
            <div className="space-y-2">
              {members.map(m => {
                const RoleIcon = ROLE_ICON[m.role] || Users;
                return (
                  <div key={m.id} className="bg-muted/30 border border-border rounded-xl p-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary/20 flex items-center justify-center">
                      <Users size={14} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{m.profile?.full_name || "Athlete"}</p>
                      <p className="text-[11px] text-muted-foreground capitalize flex items-center gap-1">
                        <RoleIcon size={10} /> {m.role}
                      </p>
                    </div>
                    {showSettings && isOwner && m.user_id !== user?.id && (
                      <select value={m.role} onChange={e => setRole(m.id, e.target.value)}
                        className="text-[11px] bg-card border border-border rounded-lg px-2 py-1">
                        <option value="member">member</option>
                        <option value="moderator">moderator</option>
                        <option value="leader">leader</option>
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {membership && !isOwner && (
            <motion.button whileTap={{ scale: 0.97 }} onClick={onLeave}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-destructive/30 text-destructive text-sm font-semibold hover:bg-destructive/5 transition-all">
              <LogOut size={14} /> Leave Community
            </motion.button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

export default Communities;
