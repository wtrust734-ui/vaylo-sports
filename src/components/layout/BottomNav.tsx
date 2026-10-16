import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Home, Dumbbell, Gauge, User } from "lucide-react";
import QuickActionSheet from "./QuickActionSheet";
import { hapticTap } from "@/lib/haptics";

const LEFT = [
  { icon: Home, labelKey: "navigation.home", path: "/", exact: true },
  { icon: Dumbbell, labelKey: "navigation.train", path: "/train", exact: false },
] as const;
const RIGHT = [
  { icon: Gauge, labelKey: "navigation.perform", path: "/perform", exact: false },
  { icon: User, labelKey: "navigation.profile", path: "/profile", exact: true },
] as const;

const isActivePath = (item: { path: string; exact: boolean }, pathname: string) =>
  item.exact ? pathname === item.path : pathname.startsWith(item.path);

const NavButton = ({ item }: { item: (typeof LEFT)[number] | (typeof RIGHT)[number] }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const isActive = isActivePath(item, location.pathname);
  const Icon = item.icon;
  const label = t(item.labelKey);

  return (
    <button
      type="button"
      role="tab"
      aria-label={label}
      aria-selected={isActive}
      aria-current={isActive ? "page" : undefined}
      onClick={() => {
        void hapticTap();
        navigate(item.path);
      }}
      // `flex-1` + `min-w-[48px]` + `overflow-hidden` are what keep this row
      // inside the screen on a 320px phone. `min-w-[48px]` alone was not
      // enough: a tab's width was set by its label's intrinsic width (a
      // nowrap "Perform" at 12px with tracking-widest is ~59px, plus 16px of
      // padding), so four tabs needed ~364px inside a 280px box and the last
      // one — Profile — was drawn 15px past the right edge, half off-screen
      // and hard to hit. `flex-1` makes the two tabs in a group share the
      // space evenly, `min-w-[48px]` keeps the 44px touch floor intact, and
      // `overflow-hidden` means the worst case is an ellipsis rather than an
      // element outside the viewport, in any language.
      className="press relative flex min-w-[48px] min-h-[64px] flex-1 flex-col items-center justify-center gap-1 overflow-hidden px-2.5 py-2.5 max-[400px]:px-1 max-[400px]:py-2"
    >
      {/* Native active marker: a M3 pill that SHARES one layout id across all
          four tabs, so instead of each tab's pill popping in and out (the
          "instant jump" the athlete reported), one rounded indicator slides
          between tabs on a spring — the interrupted-by-another-tap case
          retargets from its current position, which is what makes repeated
          fast taps feel continuous rather than queueing pop-in/out pairs.
          Spring over tween here deliberately: tweens of 150-200ms read as
          disconnected from the finger; this one is tuned fast with a little
          overshoot (stiffness ~500 → settle ≈ 220ms) which is the
          playful-but-not-bouncy zone M3's motion guidance gives for
          emphasised transitions. `prefers-reduced-motion` collapses it via
          MotionConfig in AppLayout's provider tree.

          The pill is ABSOLUTE behind the icon, not the icon's wrapper. It
          used to wrap the icon and toggle `invisible` for inactive tabs —
          `visibility: hidden` inherits, so every inactive tab's icon was
          hidden with it: athletes literally saw an icon only on the tab they
          were on, with just a dim label on the other three. Now the pill and
          the icon are siblings inside one fixed-size keyhole, the icon is
          always rendered, and the pill slides under it. */}
      <span
        aria-hidden
        // `px-3` hug (not a fixed width): a fixed `w-16` pill set each tab's
        // min-content to 64px, and `min-w-[48px]` was not high enough to beat
        // it — the Profile tab was pushed 48px off a 320px screen, caught by
        // `ui:check` on phone-320. The keyhole hugging the 24px icon at
        // ~46px keeps the 48px floor real in every language.
        className="relative flex h-8 items-center justify-center rounded-full px-3.5 px-2.5"
      >
        {isActive && (
          <motion.span
            layoutId="vaylo-tab-indicator"
            transition={{ type: "spring", stiffness: 500, damping: 34, mass: 1 }}
            aria-hidden
            // The double sheet: a faint wash reads as the pressed surface,
            // the tighter core pill inside it reads as the M3 "active
            // indicator" filled at the icon's weight — flat `bg-primary/15`
            // alone looked like a smudge rather than a control.
            className="absolute inset-0 rounded-full bg-primary/[0.14] ring-1 ring-inset ring-primary/20"
          >
            <span className="absolute inset-[3.5px] rounded-full bg-primary/[0.10]" />
          </motion.span>
        )}
        <motion.span
          animate={{ scale: isActive ? 1 : 0.94, y: isActive ? 0 : 1 }}
          transition={{ type: "spring", stiffness: 550, damping: 30 }}
          className="flex"
        >
          <Icon
            size={24}
            strokeWidth={isActive ? 2.25 : 1.9}
            aria-hidden
            className={
              isActive
                ? "text-primary drop-shadow-[0_0_10px_hsl(var(--primary)/0.35)]"
                : "text-muted-foreground/85"
            }
            style={{
              // Colour crossfades over the same 150ms window the label uses,
              // so icon and caption swap identity together; without a
              // duration the forced spring re-render makes the icon blink
              // full-contrast in one frame while the label still fades.
              transition: "color 150ms ease",
            }}
          />
        </motion.span>
      </span>
      <span
        // `w-full` so the truncation happens against the tab's real width
        // rather than the label's own max-content, which is what let the row
        // overflow. Below 400px the type steps down from 12px/tracking-widest
        // to 10.5px/tracking-normal, which is enough for the longest English
        // label ("Perform") to fit a 320px phone without an ellipsis.className={`relative z-10 w-full max-w-[80px] truncate text-center text-[12px] font-medium transition-colors duration-150 max-[400px]:text-[11px] ${isActive ? "text-primary" : "text-muted-foreground/85"}`}
      >
        {label}
      </span>
    </button>
  );
};

const BottomNav = () => {
  const { t } = useTranslation();
  /* Floating-layer ladder. Everything that is modal lives above this bar,
     because a `position: fixed` sibling rendered later wins at equal z-index
     — so a modal that claimed z-50 got a bright, tappable tab bar painted on
     top of its own scrim, and any bottom-anchored content of that modal was
     hidden behind the bar's card.

       50  BottomNav (this bar)
       55  QuickActionSheet scrim      56  QuickActionSheet panel
       57  AppSidebar scrim            58  AppSidebar drawer
       59  in-page modals and bottom sheets
       60+ app-level promos, top-up sheets, celebrations

     Page chrome that is *meant* to sit under the bar (the Coach composer, the
     AI save bar, the leaderboard row) stays below 50 and instead offsets
     itself above the bar with
     `bottom-[calc(var(--vaylo-inset-bottom)+7rem)]`. That clearance was
     5.25rem (84px) against the old 65px card; the re-proportioned bar is
     78-90px tall including its padding floor, so 7rem (112px) still clears
     it with slack. The value is shared with five files — over-clearing is not
     a defect, under-clearing strips a floating control behind the tab bar. */
  return (
    <nav
      aria-label={t("navigation.primaryNav")}
      className="fixed inset-x-0 bottom-0 z-50 lg:hidden"
    >
      {/* Native tab bar: full-bleed, hairline top edge, translucent blur. The
          old floating pill (inset-x-3, rounded card hovering over content) is
          the clearest "web page in a wrapper" tell — iOS and Android tab bars
          both run edge to edge. The bottom inset is consumed as padding on
          this surface (not position), so the hairline sits exactly above the
          gesture bar. `bottom-[max(0.5rem,…)]` is intentionally kept as the
          padding token so the inset contract tests keep guarding it.

          Proportions: the row was re-sized to Material 3 after the release
          screenshots read as "the whole bar shrunk". M3 bottom navigation is
          80dp tall with 24dp icons in a 32dp pill over 12px medium labels —
          the previous 56px floor, 22px icons and 11px labels reproduced the
          same *ratio* at ~80% of the platform scale, which is why every
          element looked consistent but small. New geometry: 64px tab floor
          + 6px top pad + 8px pd floor = 78px of bar before the gesture inset
          (80dp once the inset is non-zero), 24px icons, 12px labels. */}
      <div className="native-tabbar pb-[max(0.5rem,var(--vaylo-inset-bottom))]">
        {/* FAB sits BETWEEN the two tab groups, not after them.

            The screenshot on the Pixel showed the plus button left of centre:
            with the old `max-w-[520px]` inner row the FAB inherited its position
            from the tab labels, and "Perform"/"Profile" are wider than
            "Home"/"Train", so the groups were not equal and the button drifted
            left (~14px at 411 CSS px — clearly visible on a 1080px screenshot).
            A previous repair attempt moved the action sheet to the END of
            the flex row, which would hug the button against Profile instead —
            hard right, equally wrong.

            The correct construction is Left-group | FAB | Right-group, with both
            groups `flex-1`: the two halves are equal whatever the labels say, so
            the button between them is centred on the bar by arithmetic, at every
            width, in every language — no magic offset. */}
        <div className="w-full flex items-stretch gap-1 px-2 pt-1.5">
          <div className="flex min-w-0 flex-1 items-center justify-around gap-1">
            {LEFT.map((item) => (
              <NavButton key={item.path} item={item} />
            ))}
          </div>
          <QuickActionSheet />
          <div className="flex min-w-0 flex-1 items-center justify-around gap-1">
            {RIGHT.map((item) => (
              <NavButton key={item.path} item={item} />
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default BottomNav;
