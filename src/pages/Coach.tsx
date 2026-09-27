import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquare, Plus, Trash2, Edit3, Send, Loader2, Brain, X, ChevronLeft, Database } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getLocalPBs } from "@/lib/athleteDossier";
import { useTranslation } from "react-i18next";
import { isCurrentLanguageRtl } from "@/i18n";
import ReactMarkdown from "react-markdown";

type Msg = { role: "user" | "assistant"; content: string };
type Conv = { id: string; title: string; updated_at: string };
type Memory = { id: string; category: string; key: string; value: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/coach-chat`;

/**
 * Slide-in offset for end-anchored drawers. Physical x transforms don't
 * follow the RTL anchor swap, so the direction is read from the live
 * document instead of caching it — the drawer always slides from its edge.
 */
const drawerSlide = () => (document.documentElement.dir === "rtl" ? "-100%" : "100%");

const Coach = () => {
  const { user, profile, refreshProfile } = useAuth();
  const { toast } = useToast();
  const [convs, setConvs] = useState<Conv[]>([]);
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from("coach_conversations").select("*").eq("user_id", user.id)
      .order("updated_at", { ascending: false }).then(({ data }) => setConvs(data || []));
  }, [user]);

  useEffect(() => {
    if (!activeConv || !user) { setMessages([]); return; }
    supabase.from("coach_messages").select("*").eq("conversation_id", activeConv)
      .order("created_at", { ascending: true }).then(({ data }) => {
        setMessages((data || []).map(m => ({ role: m.role as "user" | "assistant", content: m.content })));
      });
  }, [activeConv, user]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const loadMemories = async () => {
    if (!user) return;
    const { data } = await supabase.from("coach_memories").select("*").eq("user_id", user.id).order("updated_at", { ascending: false });
    setMemories(data || []);
  };

  const createConversation = async () => {
    if (!user) return;
    const { data, error } = await supabase.from("coach_conversations").insert({ user_id: user.id, title: "New Chat" }).select().single();
    if (error) { toast({ title: "Couldn't start a new chat", description: error.message, variant: "destructive" }); return; }
    if (data) {
      setConvs(prev => [data, ...prev]);
      setActiveConv(data.id);
      setMessages([]);
      setSidebarOpen(false);
    }
  };

  const deleteConversation = async (id: string) => {
    const { error: msgError } = await supabase.from("coach_messages").delete().eq("conversation_id", id);
    const { error: convError } = await supabase.from("coach_conversations").delete().eq("id", id);
    if (msgError || convError) {
      toast({ title: "Couldn't delete the chat", description: (msgError || convError)!.message, variant: "destructive" });
      return;
    }
    setConvs(prev => prev.filter(c => c.id !== id));
    if (activeConv === id) { setActiveConv(null); setMessages([]); }
  };

  const renameConversation = async (id: string) => {
    if (!newTitle.trim()) return;
    const { error } = await supabase.from("coach_conversations").update({ title: newTitle.trim() }).eq("id", id);
    if (error) { toast({ title: "Couldn't rename the chat", description: error.message, variant: "destructive" }); return; }
    setConvs(prev => prev.map(c => c.id === id ? { ...c, title: newTitle.trim() } : c));
    setEditingTitle(null);
    setNewTitle("");
  };

  const deleteMemory = async (id: string) => {
    const { error } = await supabase.from("coach_memories").delete().eq("id", id);
    if (error) { toast({ title: "Couldn't delete that memory", description: error.message, variant: "destructive" }); return; }
    setMemories(prev => prev.filter(m => m.id !== id));
  };

  const parseMemorySaves = useCallback(async (text: string) => {
    if (!user) return;
    const regex = /\[MEMORY_SAVE:\s*category=([^,]+),\s*key=([^,]+),\s*value=([^\]]+)\]/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const [, category, key, value] = match;
      const { error } = await supabase.from("coach_memories").upsert({
        user_id: user.id,
        category: category.trim(),
        key: key.trim(),
        value: value.trim(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,key" }).select();
      if (error) {
        console.error("coach memory save failed:", error.message);
        toast({ title: "Couldn't save a coach memory", description: error.message, variant: "destructive" });
      }
    }
  }, [user]);

  const send = async (text: string) => {
    if (!text.trim() || loading || !user) return;

    let convId = activeConv;
    if (!convId) {
      const { data, error } = await supabase.from("coach_conversations").insert({ user_id: user.id, title: text.slice(0, 40) }).select().single();
      if (error) { toast({ title: "Couldn't start the chat", description: error.message, variant: "destructive" }); return; }
      if (!data) return;
      convId = data.id;
      setConvs(prev => [data, ...prev]);
      setActiveConv(data.id);
    }

    const userMsg: Msg = { role: "user", content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    const { error: saveMsgError } = await supabase.from("coach_messages").insert({ conversation_id: convId, user_id: user.id, role: "user", content: text });
    if (saveMsgError) {
      // Without the saved message the thread would be inconsistent on reload.
      setMessages(prev => prev.filter(m => m !== userMsg));
      setLoading(false);
      toast({ title: "Message not sent", description: saveMsgError.message, variant: "destructive" });
      return;
    }
    const { error: touchError } = await supabase.from("coach_conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
    if (touchError) console.error("conversation timestamp update failed:", touchError.message);

    let assistantSoFar = "";
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ messages: [...messages, userMsg], conversationId: convId, pbs: getLocalPBs().slice(0, 20).map((p) => ({ metric: p.metric, value: p.value, unit: p.unit, date: p.date })) }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Request failed" }));
        toast({ title: "Coach Error", description: err.error || "Something went wrong", variant: "destructive" });
        setLoading(false);
        await refreshProfile();
        return;
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantSoFar += content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
                }
                return [...prev, { role: "assistant", content: assistantSoFar }];
              });
            }
          } catch { buffer = line + "\n" + buffer; break; }
        }
      }

      if (assistantSoFar) {
        await supabase.from("coach_messages").insert({ conversation_id: convId, user_id: user.id, role: "assistant", content: assistantSoFar });
        await parseMemorySaves(assistantSoFar);
      }
      await refreshProfile();
    } catch (e) {
      console.error(e);
      toast({ title: "Error", description: "Failed to connect to Vaylo Sports Coach", variant: "destructive" });
    }
    setLoading(false);
  };

  const cleanContent = (text: string) => text.replace(/\[MEMORY_SAVE:[^\]]+\]/g, "").trim();



  // Welcome screen — no quick actions, just chat
  if (!activeConv && messages.length === 0) {
    return (
      <div className="min-h-screen bg-background pb-24">
        <div className="px-5 pb-3 pt-14 flex items-center justify-between">
          <div>
            <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-xl font-display font-bold">Vaylo Sports Coach</motion.h1>
            <p className="text-xs text-muted-foreground">3 credits per prompt · {profile?.credits ?? 0} credits</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setMemoryOpen(true); loadMemories(); }} className="p-2 rounded-xl bg-card border border-border">
              <Database size={16} className="text-muted-foreground" />
            </button>
            <button onClick={() => setSidebarOpen(true)} className="p-2 rounded-xl bg-card border border-border">
              <MessageSquare size={16} className="text-muted-foreground" />
            </button>
          </div>
        </div>

        <div className="px-5 flex flex-col items-center justify-center" style={{ minHeight: "55vh" }}>
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring" }}
            className="w-20 h-20 rounded-2xl bg-primary/10 border-2 border-primary/30 flex items-center justify-center mb-6">
            <Brain size={36} className="text-primary" />
          </motion.div>
          <h2 className="text-lg font-display font-bold mb-1">Elite AI Coach</h2>
          <p className="text-xs text-muted-foreground text-center max-w-xs mb-8">Direct. Analytical. No fluff. Creates training plans, nutrition plans, and remembers your data.</p>

          {/* Input bar directly on welcome */}
          <div className="w-full mb-4">
            <div className="flex gap-2 items-end">
              <textarea value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                placeholder="Ask your coach anything..." rows={2}
                className="flex-1 bg-card border border-border rounded-xl px-4 py-3 text-sm resize-none max-h-32 focus:outline-none focus:ring-2 focus:ring-primary/50" />
              <motion.button onClick={() => send(input)} disabled={!input.trim() || loading} whileTap={{ scale: 0.9 }}
                className="bg-gradient-primary text-primary-foreground p-3 rounded-xl disabled:opacity-40 shadow-glow">
                <Send size={18} />
              </motion.button>
            </div>
          </div>

          <button onClick={createConversation}
            className="flex items-center gap-2 text-sm text-primary font-semibold">
            <Plus size={16} /> New Chat
          </button>
        </div>

        <ConvSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} convs={convs}
          onSelect={(id) => { setActiveConv(id); setSidebarOpen(false); }} onDelete={deleteConversation}
          onNew={createConversation} editingTitle={editingTitle} setEditingTitle={setEditingTitle}
          newTitle={newTitle} setNewTitle={setNewTitle} onRename={renameConversation} />
        <MemoryPanel open={memoryOpen} onClose={() => setMemoryOpen(false)} memories={memories} onDelete={deleteMemory} />
      </div>
    );
  }

  // Chat view
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-4 pt-14 pb-3 flex items-center gap-3 border-b border-border">
        <button onClick={() => { setActiveConv(null); setMessages([]); }} className="p-1.5 text-muted-foreground"><ChevronLeft size={20} /></button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{convs.find(c => c.id === activeConv)?.title || "New Chat"}</p>
          <p className="text-[10px] text-muted-foreground">{profile?.credits ?? 0} credits remaining</p>
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => { setMemoryOpen(true); loadMemories(); }} className="p-1.5 text-muted-foreground"><Database size={16} /></button>
          <button onClick={() => setSidebarOpen(true)} className="p-1.5 text-muted-foreground"><MessageSquare size={16} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-32">
        {messages.map((m, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
              m.role === "user"
                ? "bg-primary text-primary-foreground rounded-br-md"
                : "bg-card border border-border rounded-bl-md"
            }`}>
              {m.role === "assistant" ? (
                <div className="prose prose-sm prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                  <ReactMarkdown>{cleanContent(m.content)}</ReactMarkdown>
                </div>
              ) : m.content}
            </div>
          </motion.div>
        ))}
        {loading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex justify-start">
            <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3">
              <Loader2 size={16} className="animate-spin text-primary" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Lifted clear of the mobile tab bar (the `tab` token matches BottomNav);
          back to the screen edge once the tab bar is hidden at lg. */}
      <div className="fixed bottom-tab lg:bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t border-border px-4 py-3 pb-3 lg:pb-[calc(env(safe-area-inset-bottom,0px)+12px)]">
        <div className="flex gap-2 items-end">
          <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Ask your coach..." rows={1}
            className="flex-1 bg-card border border-border rounded-xl px-4 py-3 text-sm resize-none max-h-32" />
          <button onClick={() => send(input)} disabled={!input.trim() || loading}
            className="bg-primary text-primary-foreground p-3 rounded-xl disabled:opacity-40">
            <Send size={18} />
          </button>
        </div>
      </div>

      <ConvSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} convs={convs}
        onSelect={(id) => { setActiveConv(id); setSidebarOpen(false); }} onDelete={deleteConversation}
        onNew={createConversation} editingTitle={editingTitle} setEditingTitle={setEditingTitle}
        newTitle={newTitle} setNewTitle={setNewTitle} onRename={renameConversation} />
      <MemoryPanel open={memoryOpen} onClose={() => setMemoryOpen(false)} memories={memories} onDelete={deleteMemory} />
    </div>
  );
};

const ConvSidebar = ({ open, onClose, convs, onSelect, onDelete, onNew, editingTitle, setEditingTitle, newTitle, setNewTitle, onRename }: {
  open: boolean; onClose: () => void; convs: Conv[]; onSelect: (id: string) => void;
  onDelete: (id: string) => void; onNew: () => void;
  editingTitle: string | null; setEditingTitle: (id: string | null) => void;
  newTitle: string; setNewTitle: (t: string) => void; onRename: (id: string) => void;
}) => (
  <AnimatePresence>
    {open && (
      <>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-background/70 backdrop-blur-sm z-50" onClick={onClose} />
        <motion.div initial={{ x: drawerSlide() }} animate={{ x: 0 }} exit={{ x: drawerSlide() }}
          transition={{ type: "spring", stiffness: 400, damping: 35 }}
          className="fixed end-0 top-0 bottom-0 w-72 bg-card/95 backdrop-blur-xl border-s border-border z-50 flex flex-col">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <span className="font-display font-bold text-sm">Conversations</span>
            <button onClick={onClose}><X size={18} className="text-muted-foreground" /></button>
          </div>
          <div className="p-3">
            <button onClick={onNew} className="w-full flex items-center gap-2 text-sm font-semibold text-primary bg-primary/10 rounded-xl px-3 py-2.5">
              <Plus size={16} /> New Chat
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 space-y-1">
            {convs.map(c => (
              <div key={c.id} className="flex items-center gap-1 group">
                {editingTitle === c.id ? (
                  <input value={newTitle} onChange={e => setNewTitle(e.target.value)} autoFocus
                    onKeyDown={e => e.key === "Enter" && onRename(c.id)}
                    onBlur={() => setEditingTitle(null)}
                    className="flex-1 bg-muted border border-border rounded-lg px-2 py-1.5 text-xs" />
                ) : (
                  <button onClick={() => onSelect(c.id)}
                    className="flex-1 text-start text-xs py-2 px-2 rounded-lg hover:bg-muted truncate">{c.title}</button>
                )}
                <button onClick={() => { setEditingTitle(c.id); setNewTitle(c.title); }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground"><Edit3 size={12} /></button>
                <button onClick={() => onDelete(c.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-destructive"><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        </motion.div>
      </>
    )}
  </AnimatePresence>
);

const MemoryPanel = ({ open, onClose, memories, onDelete }: {
  open: boolean; onClose: () => void; memories: Memory[]; onDelete: (id: string) => void;
}) => (
  <AnimatePresence>
    {open && (
      <>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-background/70 backdrop-blur-sm z-50" onClick={onClose} />
        <motion.div initial={{ x: drawerSlide() }} animate={{ x: 0 }} exit={{ x: drawerSlide() }}
          transition={{ type: "spring", stiffness: 400, damping: 35 }}
          className="fixed end-0 top-0 bottom-0 w-72 bg-card/95 backdrop-blur-xl border-s border-border z-50 flex flex-col">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <span className="font-display font-bold text-sm">Memory Bank</span>
            <button onClick={onClose}><X size={18} className="text-muted-foreground" /></button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {memories.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">No memories stored yet. Chat with your coach and share data to build your profile.</p>}
            {memories.map(m => (
              <div key={m.id} className="bg-muted/30 rounded-xl p-3 group">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-primary font-semibold uppercase">{m.category}</span>
                  <button onClick={() => onDelete(m.id)} className="opacity-0 group-hover:opacity-100 text-destructive"><Trash2 size={10} /></button>
                </div>
                <p className="text-xs font-semibold">{m.key}</p>
                <p className="text-[11px] text-muted-foreground">{m.value}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </>
    )}
  </AnimatePresence>
);

export default Coach;
