import { useState } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  onComplete: () => void;
}

const PostReview = ({ onComplete }: Props) => {
  const { user } = useAuth();
  const [well, setWell] = useState("");
  const [wrong, setWrong] = useState("");
  const [changes, setChanges] = useState("");
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (user) {
      const { error } = await supabase.from("mental_reviews").insert({
        user_id: user.id, went_well: well, went_wrong: wrong, changes,
      });
      if (error) toast.error(`Review not saved: ${error.message}`);
    }
    setDone(true);
  };

  if (done) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center min-h-[50vh] px-6">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring" }}
          className="w-16 h-16 rounded-full bg-primary/10 border-2 border-primary flex items-center justify-center mb-4">
          <Check size={28} className="text-primary" />
        </motion.div>
        <h3 className="font-display font-bold text-lg mb-2">Review Saved</h3>
        <p className="text-xs text-muted-foreground text-center mb-6">Your reflection has been logged.</p>
        <button onClick={onComplete} className="bg-primary text-primary-foreground font-semibold py-3 px-8 rounded-xl text-sm">Done</button>
      </motion.div>
    );
  }

  const fields = [
    { label: "What went well?", value: well, set: setWell, placeholder: "e.g. Stayed calm at the start" },
    { label: "What went wrong?", value: wrong, set: setWrong, placeholder: "e.g. Lost focus in the final lap" },
    { label: "What changes next time?", value: changes, set: setChanges, placeholder: "e.g. Use cue word 'Drive' earlier" },
  ];

  return (
    <div className="px-5 space-y-4">
      <p className="text-xs text-muted-foreground">Quick reflection. Keep it honest.</p>
      {fields.map((f, i) => (
        <motion.div key={f.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
          className="space-y-1.5">
          <label className="text-sm font-semibold">{f.label}</label>
          <textarea value={f.value} onChange={e => f.set(e.target.value)} placeholder={f.placeholder}
            className="w-full bg-muted border border-border rounded-xl px-4 py-3 text-sm resize-none h-20" />
        </motion.div>
      ))}
      <motion.button whileTap={{ scale: 0.97 }} onClick={submit}
        disabled={!well.trim() && !wrong.trim() && !changes.trim()}
        className="w-full bg-primary text-primary-foreground font-semibold py-3 rounded-xl disabled:opacity-40 text-sm">
        Save Review
      </motion.button>
    </div>
  );
};

export default PostReview;
