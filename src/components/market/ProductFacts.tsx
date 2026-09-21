import { Check, RefreshCw, CalendarX, Infinity as InfinityIcon, Users } from "lucide-react";

export type ProductFactsProps = {
  /** What the user receives. */
  receive: string;
  /** Expiry statement, e.g. "Never expires". */
  expires: string;
  /** Renewal statement, e.g. "Renews monthly until cancelled". */
  renews: string;
  /** Lifetime statement. */
  lifetime: string;
  /** Who it's designed for. */
  designedFor: string;
};

/**
 * Full disclosure block shown on every paid product in the Market.
 * Nothing about a purchase is hidden behind a tap.
 */
export default function ProductFacts({ receive, expires, renews, lifetime, designedFor }: ProductFactsProps) {
  const rows = [
    { icon: Check, label: "You get", value: receive },
    { icon: CalendarX, label: "Expiry", value: expires },
    { icon: RefreshCw, label: "Renewal", value: renews },
    { icon: InfinityIcon, label: "Lifetime", value: lifetime },
    { icon: Users, label: "Designed for", value: designedFor },
  ];
  return (
    <dl className="mt-3 space-y-1.5 rounded-xl border border-border/60 bg-muted/30 p-3">
      {rows.map((r) => {
        const Icon = r.icon;
        return (
          <div key={r.label} className="flex items-start gap-2">
            <Icon size={11} className="mt-[3px] shrink-0 text-primary" />
            <dt className="w-[76px] shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{r.label}</dt>
            <dd className="min-w-0 flex-1 text-[11px] leading-relaxed text-foreground/85">{r.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}
