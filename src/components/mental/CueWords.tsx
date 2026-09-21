import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, X, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

const suggestions = ["Relax", "Tall", "Attack", "Drive", "Smooth", "Power", "Push", "Float", "Explode", "Breathe"];

interface Props {
  onWordsChange?: (words: string[]) => void;
}

const CueWords = ({ onWordsChange }: Props) => {
  const { user } = useAuth();
  const [words, setWords] = useState<{ id: string; word: string }[]>([]);
  const [newWord, setNewWord] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase.from("cue_words").select("*").eq("user_id", user.id).order("created_at").then(({ data }) => {
      setWords(data || []);
      setLoading(false);
      onWordsChange?.((data || []).map(w => w.word));
    });
  }, [user]);

  const addWord = async (word: string) => {
    if (!user || words.length >= 3 || !word.trim()) return;
    const { data, error } = await supabase.from("cue_words").insert({ user_id: user.id, word: word.trim() }).select().single();
    if (error) { toast.error(`Couldn't save that cue word: ${error.message}`); return; }
    if (data) {
      const next = [...words, data];
      setWords(next);
      onWordsChange?.(next.map(w => w.word));
      setNewWord("");
    }
  };

  const removeWord = async (id: string) => {
    const { error } = await supabase.from("cue_words").delete().eq("id", id);
    if (error) { toast.error(`Couldn't remove that cue word: ${error.message}`); return; }
    const next = words.filter(w => w.id !== id);
    setWords(next);
    onWordsChange?.(next.map(w => w.word));
  };

  if (loading) return <div className="px-5 py-10 text-center text-muted-foreground text-sm">Loading...</div>;

  return (
    <div className="px-5 space-y-5">
      <p className="text-xs text-muted-foreground">Choose up to 3 cue words. These appear in Race Mode to keep you locked in.</p>

      {/* Current words */}
      <div className="flex gap-3 justify-center min-h-[60px]">
        <AnimatePresence>
          {words.map(w => (
            <motion.div key={w.id} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
              className="relative bg-primary/10 border border-primary/30 rounded-xl px-5 py-3">
              <span className="text-lg font-display font-black text-primary">{w.word}</span>
              <button onClick={() => removeWord(w.id)} className="absolute -top-2 -right-2 bg-card border border-border rounded-full p-0.5">
                <X size={12} className="text-muted-foreground" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
        {words.length === 0 && <p className="text-sm text-muted-foreground italic self-center">No cue words set</p>}
      </div>

      {words.length < 3 && (
        <>
          {/* Quick picks */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">Quick picks</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.filter(s => !words.some(w => w.word === s)).map(s => (
                <button key={s} onClick={() => addWord(s)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:border-primary/30 hover:text-primary transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Custom input */}
          <div className="flex gap-2">
            <input value={newWord} onChange={e => setNewWord(e.target.value)} placeholder="Custom word..."
              maxLength={12} onKeyDown={e => e.key === "Enter" && addWord(newWord)}
              className="flex-1 bg-muted border border-border rounded-xl px-4 py-2.5 text-sm" />
            <button onClick={() => addWord(newWord)} disabled={!newWord.trim()}
              className="bg-primary text-primary-foreground p-2.5 rounded-xl disabled:opacity-40">
              <Plus size={18} />
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default CueWords;
