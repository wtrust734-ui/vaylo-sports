import { type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { ChevronRight, type LucideIcon } from "lucide-react";

export interface HubLink {
  icon: LucideIcon;
  label: string;
  description: string;
  path: string;
}

export const HubHeader = ({ title, subtitle, icon: Icon }: { title: string; subtitle: string; icon: LucideIcon }) => {
  const { t } = useTranslation();
  return (
  <header className="px-5 pt-12 pb-6">
    <div className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] backdrop-blur px-3 py-1">
      <Icon size={12} className="text-primary" aria-hidden />
      <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary">{t("hub.brand")}</span>
    </div>
    <h1 className="mt-3 text-[30px] font-display font-bold tracking-tight leading-none">{title}</h1>
    <p className="mt-2 text-sm leading-relaxed text-muted-foreground max-w-[32ch]">{subtitle}</p>
  </header>
  );
};

export const HubTile = ({ icon: Icon, label, description, path }: HubLink) => {
  const navigate = useNavigate();
  return (
    <motion.button
      type="button"
      onClick={() => navigate(path)}
      whileTap={{ scale: 0.98 }}
      className="flex w-full items-center gap-3.5 rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur px-3.5 py-3.5 text-start transition-colors hover:bg-white/[0.06] hover:border-white/[0.10]"
      aria-label={`${label} — ${description}`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-primary shadow-glow border border-white/10">
        <Icon size={18} className="text-primary-foreground" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold leading-tight">{label}</span>
        <span className="block truncate text-xs leading-relaxed text-muted-foreground">{description}</span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-muted-foreground" aria-hidden />
    </motion.button>
  );
};

export const HubGroup = ({ title, links }: { title: string; links: HubLink[] }) => (
  <section className="px-5 pb-6" aria-label={title}>
    <h2 className="mb-2.5 px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">{title}</h2>
    <div className="space-y-2">
      {links.map((l) => <HubTile key={l.path} {...l} />)}
    </div>
  </section>
);

export const HubPage = ({ icon, title, subtitle, primary, groups }: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  primary?: ReactNode;
  groups: { title: string; links: HubLink[] }[];
}) => (
  <div className="min-h-screen pb-28">
    <HubHeader icon={icon} title={title} subtitle={subtitle} />
    {primary && <div className="px-5 pb-5">{primary}</div>}
    {groups.map((g) => <HubGroup key={g.title} title={g.title} links={g.links} />)}
  </div>
);
