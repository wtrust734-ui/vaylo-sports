import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Send, Pin, Smile } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { lsGet, lsSet } from "@/lib/localStore";

interface Msg { id: string; user: string; text: string; ts: string; reactions: Record<string, number>; pinned?: boolean }
const KEY = "vaylo_team_chat_v1";
const ROSTER_KEY = "vaylo_team_roster_v1";

const EMOJIS = ["🔥", "💪", "👏", "🚀", "🏆"];

const TeamChat = () => {
  const { profile } = useAuth();
  const me = profile?.full_name || "You";
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const roster = lsGet<any[]>(ROSTER_KEY, []);
  const online = (id: string) => (parseInt(id.slice(0, 4), 16) % 3) !== 0;

  useEffect(() => { setMsgs(lsGet(KEY, [])); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const save = (m: Msg[]) => { setMsgs(m); lsSet(KEY, m); };
  const send = () => {
    if (!text.trim()) return;
    save([...msgs, { id: crypto.randomUUID(), user: me, text: text.trim(), ts: new Date().toISOString(), reactions: {} }]);
    setText("");
  };
  const react = (id: string, e: string) => save(msgs.map(m => m.id === id ? { ...m, reactions: { ...m.reactions, [e]: (m.reactions[e] || 0) + 1 } } : m));
  const pin = (id: string) => save(msgs.map(m => m.id === id ? { ...m, pinned: !m.pinned } : m));

  const pinned = msgs.filter(m => m.pinned);

  return (
    <div className="flex flex-col h-[70vh]">
      <div className="px-2 mb-2">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Members</p>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {[{ id: profile?.user_id || "self", name: me }, ...roster].map((m: any) => (
            <div key={m.id} className="flex flex-col items-center min-w-[48px]">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold">
                  {m.name.charAt(0).toUpperCase()}
                </div>
                <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-card ${online(m.id) ? "bg-success" : "bg-muted-foreground"}`} />
              </div>
              <p className="text-[9px] text-muted-foreground mt-0.5 truncate w-12 text-center">{m.name.split(" ")[0]}</p>
            </div>
          ))}
        </div>
      </div>

      {pinned.length > 0 && (
        <div className="mx-2 mb-2 bg-energy/10 border border-energy/30 rounded-xl p-2">
          <p className="text-[10px] uppercase tracking-wider text-energy font-bold flex items-center gap-1"><Pin size={10} /> Pinned</p>
          {pinned.map(p => <p key={p.id} className="text-xs mt-1">{p.text}</p>)}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-2 space-y-2">
        {msgs.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">No messages yet. Say hi to your team.</p>}
        {msgs.map(m => (
          <motion.div key={m.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            className={`max-w-[80%] ${m.user === me ? "ml-auto" : ""}`}>
            <div className={`rounded-2xl px-3 py-2 ${m.user === me ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
              <p className="text-[10px] opacity-70">{m.user}</p>
              <p className="text-sm">{m.text}</p>
            </div>
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {EMOJIS.map(e => (
                <button key={e} onClick={() => react(m.id, e)} className="text-xs bg-muted hover:bg-card rounded-full px-1.5 py-0.5">
                  {e}{m.reactions[e] ? ` ${m.reactions[e]}` : ""}
                </button>
              ))}
              <button onClick={() => pin(m.id)} className="text-[10px] text-muted-foreground hover:text-energy ml-auto"><Pin size={10} /></button>
            </div>
          </motion.div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="flex gap-2 mt-2 px-2">
        <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Message your team…"
          className="flex-1 bg-muted border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
        <button onClick={send} className="bg-gradient-primary text-primary-foreground p-2.5 rounded-xl shadow-glow"><Send size={16} /></button>
      </div>
    </div>
  );
};

export default TeamChat;
