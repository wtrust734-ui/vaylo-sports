import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Users,
  UserPlus,
  Copy,
  Check,
  MessageCircle,
  Loader2,
  ShieldCheck,
  Share2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  ensureMyFriendCode,
  fetchFriends,
  fetchIncomingRequests,
  fetchOutgoingRequests,
  sendFriendRequestByCode,
  unfriend,
  type Friend,
  type FriendRequest,
} from "@/lib/friends";
import { fetchConversations, type Conversation } from "@/lib/messages";
import {
  fetchMyShareKeys,
  shareKey,
  workoutShareInput,
} from "@/lib/activitySharing";
import ShareActivityButton from "@/components/feed/ShareActivityButton";
import ReportMenu from "@/components/safety/ReportMenu";

// ============================================================================
// FRIENDS — the hub
// ----------------------------------------------------------------------------
// The friend graph, the conversation list and the share control in one place,
// because they are one job: train with people you know. The Friends page was
// deleted on 2026-10-08 as an empty surface with no seeded users, and this is it
// back with something to do — message a friend, answer a request, hand somebody
// a session you are proud of, and end any of it safely.
//
// Safety is on every row, not behind a settings screen. Report and block live in
// ReportMenu (which is why a friend row carries the same flag icon as anybody
// else's profile), and Unfriend is a two-step inline confirm: a mis-tap on
// "Unfriend" is its own harm, and it is not recoverable by the other person.
//
// Nothing here decides access. The database refuses a message to a non-friend,
// a request across a block, and a friendship row written by hand; this screen
// only offers what is allowed and reports what the server said.
// ============================================================================

type Tab = "friends" | "requests" | "messages";

interface WorkoutRow {
  id: string;
  title: string | null;
  type: string | null;
  duration_minutes: number | null;
  distance_km: number | null;
  completed_at: string | null;
}

const since = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

const firstLetter = (name: string) => (name.trim().charAt(0) || "A").toUpperCase();

const Friends = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>("friends");
  const [loading, setLoading] = useState(true);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [myCode, setMyCode] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmUnfriend, setConfirmUnfriend] = useState<string | null>(null);
  const [workouts, setWorkouts] = useState<WorkoutRow[]>([]);
  const [shareKeys, setShareKeys] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [fr, inc, out, code, workoutRes] = await Promise.all([
        fetchFriends(user.id),
        fetchIncomingRequests(user.id),
        fetchOutgoingRequests(user.id),
        ensureMyFriendCode(user.id),
        supabase
          .from("workouts")
          .select("id,title,type,duration_minutes,distance_km,completed_at")
          .eq("user_id", user.id)
          .eq("completed", true)
          .order("completed_at", { ascending: false, nullsFirst: false })
          .limit(5),
      ]);

      const [cons, keys] = await Promise.all([
        fetchConversations(user.id, fr),
        fetchMyShareKeys(user.id),
      ]);

      setFriends(fr);
      setIncoming(inc);
      setOutgoing(out);
      setMyCode(code);
      setWorkouts((workoutRes.data ?? []) as WorkoutRow[]);
      setConversations(cons);
      setShareKeys(keys);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyCode = async () => {
    if (!myCode) return;
    try {
      await navigator.clipboard.writeText(myCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable in a webview; the code is on screen and
      // selectable, so this is not an error worth a toast.
      toast.error("Copy it by hand — the clipboard is unavailable here.");
    }
  };

  const addFriend = async () => {
    if (!user || sending) return;
    setSending(true);
    try {
      const res = await sendFriendRequestByCode(codeInput, user.id);
      if (!res.ok) {
        toast.error(res.error ?? "We couldn't send that request.");
        return;
      }
      toast.success("Request sent.");
      setCodeInput("");
      await load();
    } finally {
      setSending(false);
    }
  };

  const answer = async (requestId: string, accept: boolean) => {
    setBusyId(requestId);
    try {
      const res = accept
        ? await acceptFriendRequest(requestId)
        : await declineFriendRequest(requestId);
      if (!res.ok) {
        toast.error(res.error ?? "That didn't work.");
        return;
      }
      toast.success(accept ? "You're friends now." : "Request declined.");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const withdraw = async (requestId: string) => {
    setBusyId(requestId);
    try {
      const res = await cancelFriendRequest(requestId);
      if (!res.ok) {
        toast.error(res.error ?? "That didn't work.");
        return;
      }
      toast.success("Request withdrawn.");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const endFriendship = async (friendId: string) => {
    setConfirmUnfriend(null);
    setBusyId(friendId);
    try {
      const res = await unfriend(friendId);
      if (!res.ok) {
        toast.error(res.error ?? "That didn't work.");
        return;
      }
      toast.success("Unfriended. Your conversation is still there.");
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const unreadTotal = conversations.reduce((n, c) => n + c.unread, 0);

  const TABS: { id: Tab; label: string; badge: number }[] = [
    { id: "friends", label: "Friends", badge: friends.length },
    { id: "requests", label: "Requests", badge: incoming.length },
    { id: "messages", label: "Messages", badge: unreadTotal },
  ];

  return (
    <div className="min-h-screen bg-background pb-28">
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-4">
        <p className="text-[12px] font-semibold uppercase tracking-widest text-primary">Compete</p>
        <h1 className="mt-1 text-2xl font-display font-bold">Friends</h1>
        <p className="mt-1 max-w-[42ch] text-sm text-muted-foreground">
          Message the athletes you train with, answer requests, and share the sessions you want
          people to see.
        </p>
      </div>

      <div className="px-5">
        <div
          role="tablist"
          aria-label="Friends sections"
          className="flex gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl text-[13px] font-semibold transition-colors ${
                tab === t.id ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-white/[0.04]"
              }`}
            >
              {t.label}
              {t.badge > 0 && (
                <span className="rounded-full bg-primary/20 px-1.5 text-[11px] font-bold text-primary">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <Loader2 className="animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && tab === "friends" && (
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="px-5 pt-5">
          <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4">
            <h2 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
              <UserPlus size={14} /> Add a friend
            </h2>

            <div className="mt-3 flex items-center gap-2">
              <div className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2">
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Your code</p>
                <p data-testid="friend-code" className="truncate font-mono text-lg font-bold tracking-[0.2em]">
                  {myCode ?? "—"}
                </p>
              </div>
              <button
                type="button"
                onClick={copyCode}
                disabled={!myCode}
                aria-label="Copy your friend code"
                className="press grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-border disabled:opacity-40"
              >
                {copied ? <Check size={16} className="text-primary" /> : <Copy size={16} />}
              </button>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Give that code to somebody you train with. They can also send you one:
            </p>

            <div className="mt-2 flex items-center gap-2">
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                placeholder="Their code"
                aria-label="Friend code to add"
                autoComplete="off"
                className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-border bg-background px-3 font-mono tracking-[0.15em] outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={addFriend}
                disabled={sending || codeInput.trim().length < 4}
                className="press flex min-h-[44px] items-center gap-1.5 rounded-xl bg-gradient-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : "Send"}
              </button>
            </div>

            {outgoing.length > 0 && (
              <div className="mt-3 space-y-1 border-t border-border/60 pt-3">
                {outgoing.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm">
                      Waiting on <span className="font-semibold">{r.name}</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => withdraw(r.id)}
                      disabled={busyId === r.id}
                      className="press min-h-[44px] px-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
                    >
                      Withdraw
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <h2 className="mt-6 mb-2 flex items-center gap-2 px-1 text-[13px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
            <Users size={14} /> {friends.length === 1 ? "1 friend" : `${friends.length} friends`}
          </h2>

          {friends.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-5 text-center">
              <Users size={20} className="mx-auto text-muted-foreground" />
              <p className="mt-2 text-sm font-semibold">No friends yet</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Share your code above. Until somebody adds you, there is nobody to message and
                nothing to share with — everything on this screen is real, and this is an honest
                empty state rather than a stock list of people.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {friends.map((f) => (
                <li key={f.id} className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                      {firstLetter(f.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{f.name}</p>
                      <p className="text-[12px] text-muted-foreground">
                        Friends since {since(f.since) || "today"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(`/friends/${f.id}`)}
                      aria-label={`Message ${f.name}`}
                      className="press flex min-h-[44px] items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 text-[13px] font-semibold text-primary"
                    >
                      <MessageCircle size={14} /> Message
                    </button>
                    <ReportMenu
                      targetType="profile"
                      targetId={f.id}
                      targetLabel={`Friend: ${f.name}`}
                      authorId={f.id}
                      allowBlock
                      onBlocked={() => void load()}
                    />
                  </div>

                  <div className="mt-2 flex items-center gap-2 border-t border-border/50 pt-2">
                    {confirmUnfriend === f.id ? (
                      <>
                        <p className="flex-1 text-xs text-muted-foreground">
                          Unfriend {f.name}? They aren't told, and you can add each other again.
                        </p>
                        <button
                          type="button"
                          onClick={() => endFriendship(f.id)}
                          disabled={busyId === f.id}
                          className="press min-h-[44px] rounded-xl border border-destructive/40 bg-destructive/10 px-3 text-[13px] font-semibold text-destructive"
                        >
                          {busyId === f.id ? <Loader2 size={14} className="animate-spin" /> : "Yes, unfriend"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmUnfriend(null)}
                          aria-label="Keep this friend"
                          className="press grid h-11 w-11 place-items-center rounded-xl border border-border"
                        >
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="flex-1 text-[12px] text-muted-foreground">
                          Sharing is per activity and yours to withdraw.
                        </p>
                        <button
                          type="button"
                          onClick={() => setConfirmUnfriend(f.id)}
                          className="press min-h-[44px] rounded-xl border border-border px-3 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
                        >
                          Unfriend
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* ---------------------------------------------------------------- */}
          <h2 className="mt-6 mb-2 flex items-center gap-2 px-1 text-[13px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
            <Share2 size={14} /> Share your training
          </h2>
          <p className="mb-2 px-1 text-xs leading-relaxed text-muted-foreground">
            Only what you share from here is visible to other athletes — your training history stays
            private. Sharing the same session twice is safe: it never publishes it twice. Once it is
            shared you can send it to one friend from a conversation.
          </p>

          {workouts.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-5 text-center">
              <p className="text-sm font-semibold">Nothing to share yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Log a session in Workouts and it will appear here.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {workouts.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{w.title || "Session"}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {[
                        since(w.completed_at),
                        w.duration_minutes ? `${w.duration_minutes} min` : null,
                        w.distance_km ? `${Number(w.distance_km)} km` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <ShareActivityButton
                    input={workoutShareInput(w)}
                    shared={shareKeys.has(shareKey("workout", w.id))}
                    onToggle={(next) => {
                      const key = shareKey("workout", w.id);
                      setShareKeys((prev) => {
                        const copy = new Set(prev);
                        if (next) copy.add(key);
                        else copy.delete(key);
                        return copy;
                      });
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </motion.section>
      )}

      {!loading && tab === "requests" && (
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="px-5 pt-5">
          <h2 className="mb-2 px-1 text-[13px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
            Waiting on you
          </h2>

          {incoming.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-5 text-center">
              <p className="text-sm font-semibold">No requests waiting</p>
              <p className="mt-1 text-xs text-muted-foreground">
                When somebody sends you their code, their request appears here.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {incoming.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                    {firstLetter(r.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{r.name}</p>
                    <p className="text-[12px] text-muted-foreground">
                      Asked {since(r.createdAt) || "today"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => answer(r.id, true)}
                    disabled={busyId === r.id}
                    className="press min-h-[44px] rounded-xl bg-gradient-primary px-4 text-[13px] font-semibold text-primary-foreground disabled:opacity-40"
                  >
                    {busyId === r.id ? <Loader2 size={14} className="animate-spin" /> : "Accept"}
                  </button>
                  <button
                    type="button"
                    onClick={() => answer(r.id, false)}
                    disabled={busyId === r.id}
                    className="press min-h-[44px] rounded-xl border border-border px-3 text-[13px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    Decline
                  </button>
                </li>
              ))}
            </ul>
          )}

          {outgoing.length > 0 && (
            <>
              <h2 className="mt-6 mb-2 px-1 text-[13px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70">
                Sent by you
              </h2>
              <ul className="space-y-2">
                {outgoing.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{r.name}</p>
                      <p className="text-[12px] text-muted-foreground">Not answered yet</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => withdraw(r.id)}
                      disabled={busyId === r.id}
                      className="press min-h-[44px] rounded-xl border border-border px-3 text-[13px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-40"
                    >
                      Withdraw
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <div className="mt-6 flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-primary" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              You can report or block anybody, including a friend — the flag icon on a friend's row
              does both. A block also ends the friendship and stops messages in both directions, and
              neither athlete can send the other a request afterwards.
            </p>
          </div>
        </motion.section>
      )}

      {!loading && tab === "messages" && (
        <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="px-5 pt-5">
          {conversations.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-5 text-center">
              <MessageCircle size={20} className="mx-auto text-muted-foreground" />
              <p className="mt-2 text-sm font-semibold">No messages yet</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Pick a friend and say something. Messages only travel between the two of you, and
                only while you are friends.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {conversations.map((c) => (
                <li key={c.friendId}>
                  <button
                    type="button"
                    onClick={() => navigate(`/friends/${c.friendId}`)}
                    className="press flex w-full items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 text-start"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                      {firstLetter(c.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold">{c.name}</span>
                        {c.unread > 0 && (
                          <span className="rounded-full bg-primary/20 px-1.5 text-[11px] font-bold text-primary">
                            {c.unread} new
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                        {c.lastFromMe ? "You: " : ""}
                        {c.lastBody || "Shared an activity"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </motion.section>
      )}
    </div>
  );
};

export default Friends;
