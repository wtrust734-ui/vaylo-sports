import { type CSSProperties, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { ChevronRight, Lock, type LucideIcon } from "lucide-react";

export interface HubLink {
  icon: LucideIcon;
  label: string;
  description: string;
  path: string;
  /**
   * True when the destination is a purchased unlock the athlete does not own
   * yet (Mental Gym, Injury Management). The tile still navigates — the page
   * itself carries the paywall and the purchase call — but it wears a lock so
   * "bought" and "open" visibly match. Icon only, so no new strings are
   * needed in any locale.
   */
  locked?: boolean;
}

export const HubHeader = ({ title, subtitle, icon: Icon }: { title: string; subtitle: string; icon: LucideIcon }) => {
  const { t } = useTranslation();
  return (
  <header className="px-5 pt-[var(--vaylo-screen-top)] pb-6">
    <div className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] backdrop-blur px-3 py-1">
      <Icon size={12} className="text-primary" aria-hidden />
      <span className="text-[12px] font-bold uppercase tracking-[0.16em] text-primary">{t("hub.brand")}</span>
    </div>
    <h1 className="mt-3 text-[30px] font-display font-bold tracking-tight leading-none">{title}</h1>
    <p className="mt-2 text-sm leading-relaxed text-muted-foreground max-w-[32ch]">{subtitle}</p>
  </header>
  );
};

export const HubTile = ({ icon: Icon, label, description, path, locked }: HubLink) => {
  const navigate = useNavigate();
  return (
    <motion.button
      type="button"
      onClick={() => navigate(path)}
      whileTap={{ scale: 0.97 }}
      /* 16px interior on all four sides. It was 14px horizontal while the tile's
         own icon padding was 16px, so a long label sat closer to the tile edge
         than to the icon it belonged to. `press` gives the same touch-down dip
         as every other tappable surface — CSS, so it fires on touch-down
         rather than when the gesture is recognised. */
      className="press flex w-full items-center gap-3.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] shadow-[var(--vaylo-elev-card)] px-4 py-4 text-start transition-colors hover:bg-white/[0.06] hover:border-white/[0.10]"
      aria-label={`${label} — ${description}`}
    >
      {/* A tinted tile, not a solid gradient one.

          Every hub row used `bg-gradient-primary shadow-glow` with a white
          icon, so a hub screen was 4-6 identical saturated blue squares whose
          only difference was the glyph inside — the loudest element on the page
          was the one carrying the least information, and it competed with the
          real primary action above it (`Start workout`). A 10% tint with a
          primary-coloured glyph keeps the brand cue and the same tile shape
          while letting the icon — the thing that actually distinguishes one row
          from the next — carry the colour. The saturated gradient is now spent
          where it means something: the primary button, and the FAB. */}
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
        <Icon size={18} className="text-primary" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold leading-tight">{label}</span>
        <span className="block truncate text-xs leading-relaxed text-muted-foreground">{description}</span>
      </span>
      {locked ? (
        <Lock size={16} className="shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <ChevronRight size={16} className="shrink-0 text-muted-foreground" aria-hidden />
      )}
    </motion.button>
  );
};

export const HubGroup = ({ title, links }: { title: string; links: HubLink[] }) => (
  /* `cv-auto` + a size hint: every hub is 3–5 groups of static tiles, and only
     the first group is on screen at rest. The browser then skips style, layout
     and paint for the groups the athlete has not scrolled to yet, which is most
     of the hub's work at mount. The tiles are pure presentational buttons, so
     there is nothing inside them that needs to be live while off screen.

     The hint is 74px per tile (a tile measures 72–76px at the default text
     scale) plus the group header, so the scrollbar does not resize as groups
     are revealed. */
  <section
    className="px-5 pb-6 cv-auto"
    aria-label={title}
    style={{ "--cv-size": `${links.length * 74 + 40}px` } as CSSProperties}
  >
    <h2 className="mb-2.5 px-1 text-[12px] font-bold uppercase tracking-[0.16em] text-muted-foreground/70">{title}</h2>
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
