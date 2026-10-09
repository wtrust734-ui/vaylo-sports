import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Loader2, Paperclip, Send, Sparkles, UserMinus, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchFriends, unfriend, type Friend } from "@/lib/friends";
import {
  fetchConversation,
  markConversationRead,
  messageFromRow,
  sendMessage,
  unsendMessage,
  MESSAGE_MAX_LENGTH,
  type DirectMessage,
  type DirectMessageRow,
} from "@/lib/messages";
import {
  fetchActivitiesByIds,
  fetchMySharedActivities,
  type SharedActivityRow,
} from "@/lib/activitySharing";
import { fetchDisplayName } from "@/lib/publicIdentity";
import ReportMenu from "@/components/safety/ReportMenu";

// ============================================================================
// FRIEND CHAT — one conversation
// ----------------------------------------------------------------------------
// A conversation is only readable by the two athletes in it, and only while no
// block exists between them (the SELECT policy in
// 20261008120000_friends_messaging_and_unfriend.sql decides that, not this
// screen). Sending is friends-only and blocked-pair-proof, also in the
// database — so this page offers the composer while the friendship exists and
// says plainly why it is off when it does not, rather than turning every tap
// into a Postgres error.
//
// Safety sits in the header on purpose: report, block and unfriend are the
// actions somebody reaches for when a conversation has gone wrong, and burying
// them behind a settings screen is how a person ends up with no way out.
//
// Delivery is live over Realtime (the table is added to the publication by the
// same migration), with a refetch after every send so the thread never depends
// on a socket that may be off.
// ============================================================================

const clock = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

const FriendChat = () => {
  const { friendId } = useParams<{ friendId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [friend, setFriend] = useState<Friend | null>(null);
  const [isFriend, setIsFriend] = useState(true);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [activities, setActivities] = useState<Map<string, SharedActivityRow>>(new Map());
  const [shares, setShares] = useState<SharedActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmUnfriend, setConfirmUnfriend] = useState(false);
  const [unfriending, setUnfriending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!user || !friendId) return;
    setLoading(true);
    try {
      const mine = await fetchFriends(user.id);
      const known = mine.find((f) => f.id === friendId) ?? null;
      setFriend(
        known ?? {
          id: friendId,
          name: await fetchDisplayName(friendId),
          since: null,
        },
      );
      setIsFriend(known !== null);

      const history = await fetchConversation(friendId, user.id);
      setMessages(history);

      const [activityMap, myShares] = await Promise.all([
        fetchActivitiesByIds(
          history.map((m) => m.activityId).filter((id): id is string => typeof id === "string"),
        ),
        fetchMySharedActivities(user.id, 25),
      ]);
      setActivities(activityMap);
      setShares(myShares);

      // Opening the thread is what marks it read; the RPC only ever writes
      // read_at for messages this athlete received.
      await markConversationRead(friendId);
    } finally {
      setLoading(false);
    }
  }, [friendId, user]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live incoming messages. Realtime applies RLS per subscriber, so this only
  // ever delivers rows addressed to this athlete (and none at all once a block
  // exists between the two).
  useEffect(() => {
    if (!user || !friendId) return;
    const channel = supabase
      .channel(`dm:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages", filter: `recipient_id=eq.${user.id}` },
        (payload) => {
          const row = messageFromRow(payload.new as DirectMessageRow);
          if (row.senderId !== friendId) return;
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
          void markConversationRead(friendId);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [friendId, user]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = async (activityId?: string) => {
    if (!user || !friendId || sending) return;
    const body = text.trim();
    if (!body && !activityId) return;
    setSending(true);
    try {
      const res = await sendMessage({ recipientId: friendId, body, activityId }, user.id);
      if (!res.ok) {
        toast.error(res.error ?? "That message didn't send.");
        return;
      }
      setText("");
      setPickerOpen(false);
      const history = await fetchConversation(friendId, user.id);
      setMessages(history);
    } finally {
      setSending(false);
    }
  };

  const unsend = async (id: string) => {
    const res = await unsendMessage(id);
    if (!res.ok) {
      toast.error(res.error ?? "That message couldn't be removed.");
      return;
    }
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  const endFriendship = async () => {
    if (!friendId) return;
    setUnfriending(true);
    try {
      const res = await unfriend(friendId);
      if (!res.ok) {
        toast.error(res.error ?? "That didn't work.");
        return;
      }
      setConfirmUnfriend(false);
      setIsFriend(false);
      toast.success("Unfriended. You can still read this conversation.");
    } finally {
      setUnfriending(false);
    }
  };

  if (!user) return null;

  return (
    <div className="flex min-h-screen flex-col bg-background pb-28">
      <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-background/90 backdrop-blur">
        <div className="flex items-center gap-2 px-3 pt-[var(--vaylo-screen-top)] pb-2">
          <button
            type="button"
            onClick={() => navigate("/friends")}
            aria-label="Back to friends"
            className="press grid h-11 w-11 shrink-0 place-items-center rounded-xl"
          >
            <ArrowLeft size={18} />
          </button>
          <button
            type="button"
            onClick={() => friendId && navigate(`/profile/${friendId}`)}
            disabled={!friendId}
            className="min-w-0 flex-1 text-start"
          >
            <span className="block truncate text-sm font-semibold">{friend?.name ?? "Athlete"}</span>
            <span className="block text-[11px] text-muted-foreground">
              {isFriend ? "You are friends" : "Not friends any more"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmUnfriend((v) => !v)}
            aria-label="Unfriend this athlete"
            className="press grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground"
          >
            <UserMinus size={16} />
          </button>
          {friendId && (
            <ReportMenu
              targetType="profile"
              targetId={friendId}
              targetLabel={`Conversation with ${friend?.name ?? "an athlete"}`}
              authorId={friendId}
              allowBlock
              onBlocked={() => setIsFriend(false)}
            />
          )}
        </div>

        {confirmUnfriend && (
          <div className="flex items-center gap-2 border-t border-border/60 px-3 py-2">
            <p className="flex-1 text-xs text-muted-foreground">
              Unfriend {friend?.name ?? "this athlete"}? Messaging stops in both directions, but the
              conversation stays.
            </p>
            <button
              type="button"
              onClick={endFriendship}
              disabled={unfriending}
              className="press min-h-[44px] rounded-xl border border-destructive/40 bg-destructive/10 px-3 text-[13px] font-semibold text-destructive"
            >
              {unfriending ? <Loader2 size={14} className="animate-spin" /> : "Unfriend"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmUnfriend(false)}
              aria-label="Cancel unfriending"
              className="press grid h-11 w-11 place-items-center rounded-xl border border-border"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </header>

      {!loading && !isFriend && (
        <p className="mx-4 mt-3 rounded-2xl border border-energy/40 bg-energy/10 p-3 text-xs leading-relaxed">
          You are not friends with this athlete, so new messages are off. What you already said is
          still here — deleting either account removes it. Add each other again with a code to carry
          on.
        </p>
      )}

      <div className="flex-1 space-y-2 px-4 pt-4">
        {loading && (
          <div className="flex justify-center py-16">
            <Loader2 className="animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className="rounded-2xl border border-border bg-card p-5 text-center">
            <p className="text-sm font-semibold">No messages yet</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Say hello, or hand them a session you have shared — the paperclip sends one of yours.
            </p>
          </div>
        )}

        {messages.map((m) => {
          const mine = m.senderId === user.id;
          const activity = m.activityId ? activities.get(m.activityId) : undefined;
          return (
            <motion.div
              key={m.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${mine ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl border px-3 py-2 text-sm ${
                  mine
                    ? "border-primary/30 bg-primary/10"
                    : "border-white/[0.08] bg-white/[0.04]"
                }`}
              >
                {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}

                {m.activityId && (
                  <div className="mt-1.5 rounded-xl border border-border bg-card p-2.5">
                    {activity ? (
                      <>
                        <p className="text-[11px] uppercase tracking-widest text-primary">
                          {activity.source_kind}
                        </p>
                        <p className="text-sm font-semibold">{activity.title}</p>
                        {activity.detail && (
                          <p className="text-[12px] text-muted-foreground">{activity.detail}</p>
                        )}
                      </>
                    ) : (
                      // Withdrawn share (or one the viewer can no longer see): say
                      // so rather than rendering an empty card.
                      <p className="text-[12px] text-muted-foreground">
                        This activity is no longer shared.
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{clock(m.createdAt)}</span>
                  {mine && (
                    <button
                      type="button"
                      onClick={() => unsend(m.id)}
                      className="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                    >
                      Unsend
                    </button>
                  )}
                  {!mine && m.readAt && <span className="text-[10px] text-muted-foreground">Read</span>}
                </div>
              </div>
            </motion.div>
          );
        })}
        <div ref={endRef} />
      </div>

      {pickerOpen && (
        <div className="mx-4 mb-2 rounded-2xl border border-white/[0.08] bg-card p-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-semibold">Send one of your shared activities</p>
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              aria-label="Close activity picker"
              className="press grid h-11 w-11 place-items-center rounded-xl"
            >
              <X size={14} />
            </button>
          </div>
          {shares.length === 0 ? (
            <div className="mt-2 rounded-xl border border-border p-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                You have not shared anything yet. Share a session from the Friends screen first —
                then it can be sent here.
              </p>
            </div>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {shares.map((s) => (
                <li key={s.id} className="flex items-center gap-2 rounded-xl border border-border p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{s.title}</p>
                    <p className="truncate text-[12px] text-muted-foreground">
                      {s.detail || s.sport || s.source_kind}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => send(s.id)}
                    disabled={sending}
                    className="press min-h-[44px] rounded-xl border border-primary/30 bg-primary/10 px-3 text-[13px] font-semibold text-primary disabled:opacity-40"
                  >
                    Send
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="sticky bottom-[calc(var(--vaylo-inset-bottom)+5.25rem)] px-4"
      >
        <div className="flex items-end gap-2 rounded-2xl border border-white/[0.08] bg-card p-2">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            disabled={!isFriend}
            aria-label="Send one of your shared activities"
            className="press grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground disabled:opacity-40"
          >
            <Paperclip size={16} />
          </button>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={1}
            maxLength={MESSAGE_MAX_LENGTH}
            placeholder={isFriend ? "Message…" : "Messaging is off"}
            aria-label="Message"
            disabled={!isFriend}
            className="max-h-32 min-h-[44px] flex-1 resize-none bg-transparent px-1 py-2.5 text-sm outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!isFriend || sending || !text.trim()}
            aria-label="Send message"
            className="press grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-primary text-primary-foreground disabled:opacity-40"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
        {!isFriend && (
          <p className="mt-1.5 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
            <Sparkles size={12} /> Add each other again to carry on messaging.
          </p>
        )}
      </form>
    </div>
  );
};

export default FriendChat;
