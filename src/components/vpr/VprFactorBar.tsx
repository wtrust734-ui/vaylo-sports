import { motion } from "framer-motion";

interface Props {
  label: string;
  value: number;
  weight: number;
  animated?: boolean;
}

export default function VprFactorBar({ label, value, weight, animated = false }: Props) {
  const clamped = Math.max(0, Math.min(100, value));
  const fill = clamped;

  return (
    <div className="flex items-center gap-3">
      <span className="min-w-0 shrink-0 text-[12px] font-medium uppercase tracking-wide text-muted-foreground truncate">
        {label}
      </span>
      <div className="flex-1 h-2 overflow-hidden rounded-full bg-white/5">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-primary to-electric-purple"
          animate={animated ? { width: `${fill}%` } : { width: `${fill}%` }}
          transition={animated ? { duration: 0.9, ease: [0.22, 1, 0.36, 1] } : undefined}
        />
      </div>
      <span className="shrink-0 text-[12px] font-semibold tabular-nums text-foreground">
        {clamped}
      </span>
    </div>
  );
}
