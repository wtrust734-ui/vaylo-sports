# Vaylo Sports — UI/UX + Frontend Performance Overhaul

Scope: header/top-navigation elimination, tab transition architecture, interaction
dynamics, and the performance configuration that supports them. Written against
the code as it now stands, not as a plan.

---

## 1. Header and top-level navigation elimination

### What was removed

| Removed | Was | Why it mattered |
| --- | --- | --- |
| Mobile hamburger button | `fixed start-[max(0.75rem,var(--vaylo-inset-left))] top-[max(0.75rem,var(--vaylo-inset-top))] h-11 w-11`, `z-40`, `lg:hidden`, in `AppSidebar.tsx` | A `position: fixed` control in the start-top corner of **every** screen. Because it floats above content, ~50 screens reserved `pt-14` (56px) at the top to avoid sitting underneath it. The app's own titles therefore began a third of the way down the display for a control that most taps never needed. The body already carries the status-bar inset, so the button's own inset math was a second, redundant answer to the same question. |
| Full-screen "Loading your next screen" interstitial | `Suspense fallback={<VayloLoader message="Loading your next screen" />}` in `App.tsx` | A `fixed inset-0 z-[100]` overlay with a logo, two rotating rings and a marketing line, shown while a route chunk arrived. For a tab whose chunk was already cached this never appeared; for one that wasn't, the app appeared to restart. Replaced by `ScreenFallback`. |
| Slide transition on every navigation | `AnimatePresence mode="wait"` + `initial={{opacity: 0, y: 6}}` in `AppLayout.tsx` | `mode="wait"` holds the arriving screen until the leaving one's exit animation finishes — the largest single contributor to navigation feeling slow. The `y` offset also forced a layout pass per navigation. |

### Where the drawer's actions went

The drawer itself is **kept** — it is the full navigation catalogue (~50 routes
in seven groups). What changed is how it is entered.

* `src/components/layout/AppSidebar.tsx` now exports `OPEN_NAV_EVENT` and
  `openAppNav()`. The drawer listens for the event; nothing renders a fixed
  trigger for it.
* `src/pages/Profile.tsx` gains an **"All sections"** row as the first item in
  its menu list, plus a **"Notifications"** row — the two entries that were
  previously reachable only from the drawer on mobile.
* Everything else the drawer duplicated was already on Profile and stays there:
  Edit Profile, Settings (country, currency, water goal, language, passkeys),
  Legal & Safety centre, Privacy Policy, Terms, AI Service Status
  (`AIConnectionTest`), Delete Account, Sign Out.

Reachability of the destination set is unchanged: hub pages (`/train`,
`/perform`, `/recover`, `/compete`) remain ordinary pages, the bottom bar keeps
its five slots, and the full catalogue is one tap from Profile.

### Top-edge alignment

One token, defined once in `:root` (`src/index.css`):

```css
--vaylo-screen-top: 16px;                     /* phones */
@media (min-width: 640px) { --vaylo-screen-top: 20px; }
```

Every in-layout screen's first element uses `pt-[var(--vaylo-screen-top)]`.
The status-bar inset is **not** re-applied per screen: `body` already has
`padding-top: var(--vaylo-inset-top)`, so this token is the *design* gutter on
top of it. 47 occurrences across 31 files were converted from the old
hamburger-clearance values (`pt-14` / `pt-12` / `pt-10`).

Pages that render **outside** `AppLayout` were deliberately excluded from that
sweep, because they never had a hamburger to clear and their padding is their
own status-bar clearance: `Auth`, `Onboarding`, `NotFound`,
`ChallengeInvite`, `DiscordCommunity`, `ReferralLeaderboard`.

---

## 2. Transition architecture

### No loader on tab switching

`ScreenFallback` (`src/components/ScreenFallback.tsx`) is inline, in-flow and
gutter-aligned: a `role="status"` block with an `sr-only` "Loading…" and three
pulse bars. It is never `fixed`, so it cannot trap the user behind an overlay,
and because it occupies the same top gutter as the real content, the screen does
not jump when the chunk arrives.

`VayloLoader` is still used for the two genuinely blocking bootstrap states —
`main.tsx` before React mounts, and `AppLayout`'s "Checking your athlete
profile" — and for `RequireAdmin`. Those are app-start gates, not navigation.

### KeepAlive across the four tab roots

New: `src/components/layout/TabShell.tsx`.

```
AppLayout
├── <div hidden={!onTabRoot}>        ← host, ALWAYS mounted
│   └── TabShell  (key = session.user.id)
│       ├── <section id="tab-panel-home"    data-active>  → lazy Index
│       ├── <section id="tab-panel-train"   data-active>  → lazy Train
│       ├── <section id="tab-panel-perform" data-active>  → lazy Perform
│       └── <section id="tab-panel-profile" data-active>  → lazy Profile
└── {!onTabRoot && <div key={pathname} className="nav-fade"> <Outlet/> </div>}
```

Rules the host enforces:

1. **Mount once, on first visit.** A tab's chunk (and its queries) load the
   first time that tab is opened; after that the panel is hidden, never
   unmounted. Detail screens still mount/unmount normally — holding ~50 of them
   alive would be a memory leak with extra steps.
2. **`hidden`, not `opacity: 0`.** The inactive panels leave the accessibility
   tree, the tab order and layout at the same time.
3. **The host is never swapped out for the Outlet.** This is the non-obvious
   part and it was wrong in the first draft: rendering `TabShell` only on a tab
   root meant that tapping Train (which lands on a detail screen) unmounted all
   four panels, destroying every cached query and scroll offset. Hiding the host
   is what makes "come back and it is still there" true for detail navigation,
   not just tab-to-tab taps.
4. **Keyed by user id.** Signing out and back in as another athlete must not
   inherit the previous athlete's mounted panels.
5. **Per-tab scroll memory.** The document is the scroll container, so hiding a
   panel collapses the page height and the browser would leave the athlete at a
   clamped offset. `scrollMemory` saves the outgoing tab's `scrollY` and
   restores the incoming tab's, defaulting to `0` so a never-used tab opens at
   the top rather than at the previous screen's offset.

### The fade

```css
.nav-fade[data-active="true"] {
  animation: vaylo-nav-fade var(--vaylo-nav-fade, 160ms) cubic-bezier(0.4, 0, 0.2, 1) both;
}
@keyframes vaylo-nav-fade { from { opacity: 0 } to { opacity: 1 } }
```

Two deliberate choices:

* **An animation, not a transition.** A panel that is inactive is
  `display: none`. A transition cannot interpolate from `display: none` — the
  element has no previous rendered value — so the screen would have popped in
  fully opaque and the fade would have silently done nothing. An animation
  restarts whenever the element starts being rendered, so it fires on every
  activation including the first. (This was caught by measuring, not by reading.)
* **Opacity only, and no transform on the panel.** `will-change`/`translateZ(0)`
  on a screen wrapper makes it a containing block for `position: fixed`, which
  would silently re-anchor every fixed child inside those screens — composers,
  in-page sheets, action pills. Opacity is already compositor-handled.

Direction of the transition: the outgoing screen is gone in the same frame and
only the incoming one fades in. A true *simultaneous* cross-fade requires the
outgoing screen to stay in flow while the incoming one overlaps it, which either
changes the document height mid-transition or needs an absolutely-positioned
snapshot — both worse than the fade-through, and both would break scroll
position. Fade-through at 160ms is the same perceived result (this is what
Material's tab switching does).

---

## 3. Interaction dynamics and layout stability

### Sheets and overlays — transforms only

`QuickActionSheet` was already `y`-translate based; its timings are now on the
house curve (`180ms`, `cubic-bezier(0.4, 0, 0.2, 1)`) and it takes
`will-transform` **only while open**. A permanent `will-change: transform` keeps
a compositor layer alive for the whole session, and this component is mounted on
every screen.

Audited and already transform-based, no change needed:

* `AppSidebar` mobile drawer — `x: ±100%` spring, no height or margin animation.
* Mobile scrims (`QuickActionSheet`, `AppSidebar`) — opacity only.
* `BottomNav` active pill — `layoutId` on a transform-friendly element.
* shadcn `ui/sheet`, `ui/dialog`, `vaul` drawers — data-state transform utilities.

Known **remaining** layout-animating containers (deliberately not converted, see
open items): the `AppSidebar` group accordion (`height: 0 → auto`) and the
Profile settings panel (`height: 0 → auto`). Both must reflow their siblings, so
a transform would misplace the content below them.

### Optimistic interaction

`src/pages/Market.tsx`:

* `addToBasket` inserts a local row (`id: "optimistic:<product>"`) on the tap,
  toasts immediately, then reconciles with the saved row. On failure the
  optimistic row is **removed** and the athlete is told — a phantom row in a
  purchase flow is worse than a slow one. The synthetic id is never sent: the
  checkout payload maps `product_id/product_type/product_name/price_cents` only.
* `removeFromBasket` removes locally first and restores the row if the delete
  fails; a still-pending row is dropped without a server call.

Both now use functional `setBasket(prev => …)` updates, which also removes a
stale-closure hazard on rapid taps.

### List rendering

```css
.cv-auto { content-visibility: auto; contain-intrinsic-size: auto var(--cv-size, 360px); }
```

*Applied to:* `HubGroup` in `HubPage.tsx` — every hub is 3–5 groups of static
tiles and only the first is on screen at rest, so the browser skips style,
layout and paint for the rest. The size hint is per-group
(`links.length * 74 + 40` px) so the scrollbar does not resize as groups are
revealed.

*Not applied to:* list rows inside a transformed parent. `content-visibility`
on a row can fight scroll anchoring, and a wrong size hint there costs a
visible jump rather than one extra frame.

---

## 4. Performance configuration settings

### Tokens (`src/index.css`, `:root`)

| Token | Value | Consumer |
| --- | --- | --- |
| `--vaylo-inset-top/right/bottom/left` | `env(safe-area-inset-*)` with an injected override | the only place insets are resolved |
| `--vaylo-nav-fade` / `--vaylo-nav-fade-out` | `240ms` / `120ms` | `.nav-fade`, `.nav-enter` |
| `--vaylo-screen-top` | `16px`, `20px` ≥640px | first element of every screen |
| `--cv-size` | per-section px (default `360px`) | `.cv-auto` intrinsic size |

### Utilities (`@layer utilities`)

| Class | Purpose |
| --- | --- |
| `.nav-fade[data-active="true"]`, `.nav-enter` | 240ms opacity animation on `cubic-bezier(0, 0, 0.2, 1)` — from 0 for a tab, from 0.2 for a detail screen |
| `.gpu-layer` | `transform: translateZ(0)`; `backface-visibility: hidden` |
| `.will-transform` | `will-change: transform` — **conditionally applied only while moving** |
| `.cv-auto` | `content-visibility: auto` + `contain-intrinsic-size` |

### Fixed invariants

* Navigation duration stays inside **150–300ms**. One value, one curve, one
  class — a screen cannot hand-roll its own timing. A tab switch is a 120ms
  fade-out then a 240ms fade-in (one movement, 360ms end to end); everything
  else, including the screens rendered outside `AppLayout` by `BareScreen` in
  `App.tsx`, is the single 240ms entering fade.
* No `y`/`x` offset on a full-screen transition; no exit animation.
* No layout property (`height`, `top`, `margin`) animated in any overlay.
* No permanent `will-change`.
* `prefers-reduced-motion: reduce` already zeroes all animation and transition
  durations globally; the fade collapses to instant rather than being disabled,
  because a cross-fade between two opaque panels cannot be removed without a
  flash.
* No `transform` on a screen wrapper that contains `position: fixed` children.

### Verification (this change)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.app.json` | clean |
| `npx vitest run` | **615 passed / 46 files** (613 before; one obsolete test replaced with three) |
| `npx eslint` on the 12 changed files | 0 errors (same warning classes as before) |
| Tab switch, live in a 412×880 viewport | Home → Train → Perform → Profile → Home: all four panels mounted, exactly one shown, **no full-screen loader at any step** |
| KeepAlive across a detail screen | Home → Perform → **/workouts** → Profile → Home: panels stayed mounted through the detail screen |
| Scroll memory | Home scrolled to 263 → Perform → Home restored **263** |
| Hamburger removal | `button[aria-label="Open menu"]` absent; Home/Train/Perform/Profile titles now start at the top gutter |
| Drawer reachability | Profile → **All sections** opens the drawer with the full catalogue |

### Test updated, not deleted

`src/lib/safeAreaShell.test.ts` asserted the hamburger's inset-aware positioning
(the `top-[max(0.75rem,var(--vaylo-inset-top))]` fix for the notch). Removing
the button obsoletes that assertion, so it is replaced by three that encode the
new contract instead of dropping the guard: **no** `fixed … top-[` control in
the shell, navigation opened via `OPEN_NAV_EVENT`/`openAppNav`, and every
screen's first element anchored to `--vaylo-screen-top`.

---

## 5. Open items (not done, and why)

1. **Accordion height animations** (`AppSidebar` groups, Profile settings
   panel). These are in-flow containers whose siblings must move, so
   `transform` is the wrong tool. The correct fix is a
   `grid-template-rows: 0fr → 1fr` transition, which is still a layout
   animation but a cheaper one than `height: auto`. Judged out of scope here.
2. **Per-tab scroll *containers***. Scroll position is restored on tab
   activation but the document remains the single scroll container. Giving each
   panel its own scroller would preserve scroll *continuously* and remove the
   restore step, at the cost of reworking every sticky/fixed assumption in ~50
   screens.
3. **`cv-auto` on long list rows.** Applied to hub groups; long lists
   (Workouts, Metrics, Routines) still render every row. The safe version needs
   per-row `contain-intrinsic-size` and a check that no row is inside a
   transformed ancestor.
4. **Only the four tab roots are cached.** Detail screens unmount on navigation,
   so returning to a detail screen re-runs its queries. Caching those is a
   product decision (memory vs. freshness) rather than a layout one.
