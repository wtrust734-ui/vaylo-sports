import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { lsGet, lsSet } from "@/lib/localStore";

const EMOJI = ["😴","🥱","🙂","😊","😅","😮‍💨","😤","🥵","🥶","🥲"];
const LABEL = ["Very Easy","Easy","Light","Moderate","Steady","Brisk","Hard","Very Hard","Maximal","All-Out"];

interface RPEEntry { workout_id: string; rpe: number; date: string; type?: string; duration?: number }

export const saveRPE = (e: RPEEntry) => {
  const list = lsGet<RPEEntry[]>("vaylo_rpe_log_v1", []);
  list.unshift(e);
  lsSet("vaylo_rpe_log_v1", list.slice(0, 500));
};

export const getRPE = () => lsGet<RPEEntry[]>("vaylo_rpe_log_v1", []);

interface Props {
  open: boolean;
  workoutId?: string;
  type?: string;
  duration?: number;
  onClose: () => void;
}

const RPEModal = ({ open, workoutId, type, duration, onClose }: Props) => {
  const [rpe, setRpe] = useState(6);
  const submit = () => {
    saveRPE({ workout_id: workoutId || crypto.randomUUID(), rpe, date: new Date().toISOString(), type, duration });
    onClose();
  };
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[80] bg-background/80 backdrop-blur flex items-end sm:items-center justify-center p-4"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div initial={{ y: 40, scale: 0.96 }} animate={{ y: 0, scale: 1 }} exit={{ y: 40, scale: 0.96 }}
            className="w-full max-w-md bg-card border border-border rounded-3xl p-6 shadow-card">
            <p className="text-[11px] uppercase tracking-widest text-primary font-semibold">Post-Session</p>
            <h2 className="text-2xl font-display font-bold mt-1">Rate your effort</h2>
            <p className="text-sm text-muted-foreground">How hard did that feel? (RPE 1–10)</p>

            <div className="text-center my-8">
              <div className="text-7xl">{EMOJI[rpe - 1]}</div>
              <div className="text-5xl font-display font-bold text-primary mt-2">{rpe}</div>
              <div className="text-sm text-muted-foreground mt-1">{LABEL[rpe - 1]}</div>
            </div>

            <input type="range" min={1} max={10} value={rpe} onChange={e => setRpe(Number(e.target.value))}
              className="w-full accent-primary" />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>1 easy</span><span>5 steady</span><span>10 max</span>
            </div>

            <div className="flex gap-2 mt-6">
              <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-border text-sm text-muted-foreground">Skip</button>
              <motion.button whileTap={{ scale: 0.97 }} onClick={submit}
                className="flex-1 py-3 rounded-xl bg-gradient-primary text-primary-foreground font-semibold shadow-glow">
                Log RPE
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default RPEModal;
