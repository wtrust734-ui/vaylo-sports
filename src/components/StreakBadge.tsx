import { Flame } from "lucide-react";
import { useStreak } from "@/hooks/useStreak";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";

export default function StreakBadge({ compact = false }: { compact?: boolean }) {
  const { streak } = useStreak();
  const navigate = useNavigate();
  const count = streak?.current_streak ?? 0;
  const active = count > 0;

  return (
    <motion.button
      onClick={() => navigate("/profile")}
      whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition ${
        active ? "bg-gradient-to-r from-orange-500/20 to-energy/20 text-energy border border-energy/40" : "bg-muted/40 text-muted-foreground"
      }`}
      title={`${count} day streak${streak?.longest_streak ? ` · longest ${streak.longest_streak}` : ""}`}
    >
      <Flame className={`h-4 w-4 ${active ? "text-orange-400" : ""}`} />
      {!compact && <span>{count}</span>}
    </motion.button>
  );
}
