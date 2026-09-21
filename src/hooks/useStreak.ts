import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { getStreak, StreakState } from "@/lib/streaks";

export function useStreak() {
  const { user } = useAuth();
  const [streak, setStreak] = useState<StreakState | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) { setStreak(null); setLoading(false); return; }
    const s = await getStreak(user.id);
    setStreak(s);
    setLoading(false);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);
  return { streak, loading, refresh };
}
