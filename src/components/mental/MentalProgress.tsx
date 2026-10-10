import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";

const MentalProgress = () => {
  const { user } = useAuth();
  const [data, setData] = useState<{ date: string; readiness: number; confidence: number }[]>([]);

  useEffect(() => {
    if (!user) return;
    supabase.from("mental_checkins").select("*").eq("user_id", user.id)
      .order("created_at", { ascending: true }).limit(30)
      .then(({ data: rows }) => {
        if (!rows) return;
        setData(rows.map(r => ({
          date: new Date(r.created_at).toLocaleDateString("en", { month: "short", day: "numeric" }),
          readiness: r.readiness_score,
          confidence: r.confidence,
        })));
      });
  }, [user]);

  if (data.length < 2) {
    return (
      <div className="px-5 flex flex-col items-center justify-center min-h-[40vh]">
        <TrendingUp size={32} className="text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground text-center">Complete at least 2 check-ins to see trends.</p>
      </div>
    );
  }

  const avgReadiness = Math.round(data.reduce((a, d) => a + d.readiness, 0) / data.length);
  const trend = data[data.length - 1].readiness - data[0].readiness;

  return (
    <div className="px-5 space-y-5">
      <div className="flex gap-3">
        <div className="flex-1 bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-2xl font-display font-black text-primary">{avgReadiness}</p>
          <p className="text-xs text-muted-foreground">Avg Readiness</p>
        </div>
        <div className="flex-1 bg-card border border-border rounded-xl p-4 text-center">
          <p className={`text-2xl font-display font-black ${trend >= 0 ? "text-green-400" : "text-red-400"}`}>
            {trend >= 0 ? "+" : ""}{trend}
          </p>
          <p className="text-xs text-muted-foreground">Trend</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-xs font-semibold text-muted-foreground mb-3">Readiness Over Time</p>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data}>
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={30} />
            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
            <Line type="monotone" dataKey="readiness" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-card border border-border rounded-xl p-4">
        <p className="text-xs font-semibold text-muted-foreground mb-3">Confidence Over Time</p>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data}>
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
            <YAxis domain={[1, 10]} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={30} />
            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }} />
            <Line type="monotone" dataKey="confidence" stroke="hsl(270 95% 65%)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {trend > 0 && <p className="text-xs text-center text-primary font-medium">📈 Higher confidence = better sessions</p>}
    </div>
  );
};

export default MentalProgress;
