import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Home, Dumbbell, Gauge, User } from "lucide-react";
import { motion } from "framer-motion";
import QuickActionSheet from "./QuickActionSheet";

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
      aria-label={label}
      aria-current={isActive ? "page" : undefined}
      onClick={() => navigate(item.path)}
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
      className="press relative flex min-w-[48px] min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 overflow-hidden rounded-2xl px-2 py-1.5 max-[400px]:px-1"
    >
      {isActive && (
        <motion.div
          layoutId="nav-indicator"
          className="absolute inset-0 rounded-2xl bg-primary/15 border border-primary/25"
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
        />
      )}
      {/* Contrast, not just colour: the active tab is full-strength primary with
          a filled pill behind it, the inactive ones drop to 60% muted. The icon
          also lifts 1px and scales 6% on selection, which is the difference
          between "the colour changed" and "the tab responded to me". */}
      <Icon
        size={18}
        className={`relative z-10 transition-[color,transform] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] ${
          isActive ? "text-primary -translate-y-px scale-105" : "text-muted-foreground/60"
        }`}
      />
      <span
        // `w-full` so the truncation happens against the tab's real width
        // rather than the label's own max-content, which is what let the row
        // overflow. Below 400px the type steps down from 12px/tracking-widest
        // to 10.5px/tracking-normal, which is enough for the longest English
        // label ("Perform") to fit a 320px phone without an ellipsis.
        className={`relative z-10 w-full max-w-[64px] truncate text-center text-[12px] font-bold tracking-widest transition-colors duration-200 max-[400px]:text-[10.5px] max-[400px]:tracking-normal ${
          isActive ? "text-primary" : "text-muted-foreground/60"
        }`}
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
     Ar save bar, the leaderboard row) stays below 50 and instead offsets
     itself above the bar with
     `bottom-[calc(var(--vaylo-inset-bottom)+5.25rem)]`. That 5.25rem was sized
     against the stack as it measured before the button's lift was fixed: the
     card 34-99px above the floor and the `-mt-6` button reaching 107px. The
     button now sits inside the card (y824.4..880.0 against a card at
     y822.9..889.5 on the release APK), so the constant is generous by ~8px
     rather than exactly right — left alone deliberately, because it is shared
     with four other files and over-clearing is not a defect. */
  return (
    <nav
      aria-label={t("navigation.primaryNav")}
      className="fixed inset-x-3 bottom-[max(0.5rem,var(--vaylo-inset-bottom))] z-50 lg:hidden pointer-events-none"
    >
      {/* `nav-glass` carries the 16px backdrop blur + 72% card fill (see
          --vaylo-nav-glass). It replaces the previous `bg-card/95 sm:bg-card/75
          sm:backdrop-blur-2xl`, which was opaque on phones — where the bar
          actually needs the separation — and only blurred on larger screens. */}
      <div className="nav-glass pointer-events-auto mx-auto max-w-[520px] rounded-[22px] border border-white/[0.08] shadow-card">
        {/* Five slots: Home | Train | [FAB] | Perform | Profile.

            The 48px floor on each tab (rather than 56px) is what buys this
            row its gap. At 320px the content box is 320 - 24 (inset-x-3) - 16
            (px-2) = 280px, and the old 56px floor consumed all of it: four
            tabs plus the 56px action button came to exactly 280, leaving the
            centre button flush against its neighbours with no separation at
            all. 4x48 + 56 + 4 gaps of 4px = 264, so 16px of slack survives on
            the narrowest phone this app supports, and the wider phones the
            app actually ships on grow to fill it via justify-around.

            min-w is a floor, not a width, so it changes nothing on a screen
            with room; it only relaxes the constraint where there was none.
            48px stays above the 44px floor that touchTargets.test.ts enforces.

            The arithmetic above is about the FAB's separation, and it was the
            only thing checked when this row was written — it assumed a tab was
            48px wide, but a tab's width came from its label, so the row still
            overflowed a 320px screen by 15px. See the NavButton's own note for
            what actually holds the width now. */}
        <div className="flex items-center gap-1 px-2 py-2">
          {/* Two equal-width groups around the action button, rather than four
              `justify-around` siblings of it.

              With all five items as siblings, `justify-around` distributes its
              free space around each one, so an item's position depends on its
              own width — and the labels are not the same width. "Perform" and
              "Profile" are wider than "Home" and "Train", which pushed the
              action button left: measured in the release APK at 411x914, the
              button's centre landed at x=191.3 while the bar it sits in was
              centred at x=205.7. 14px off-centre, on the app's own primary
              action.

              `flex-1` on the two groups makes them equal whatever the labels
              say, so the button between them is centred by construction — at
              every width, in every language, without a magic number. The tabs
              inside a group keep their natural width, which is what keeps
              "Perform" from truncating: giving each of the five an equal share
              instead would have clipped it on a 320px phone. */}
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
