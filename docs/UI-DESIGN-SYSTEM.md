// ============================================================================
// DESIGN SYSTEM — VAYlo Sports
// Prompt 5: premium sports-tech redesign. Dark navy/black + purple accent.
// ============================================================================

This is the source of truth for Prompt 5. It is descriptive, not decorative:
every change should trace back to one of these decisions.

## 1. Product feel
- Premium sports technology.
- Dark, performance-focused atmosphere. Not gaming-bright, not clinical-white.
- Clear hierarchy. High readability. Restrained motion.
- Tagline as brand voice: "Learn smarter. Train better. Perform better."

## 2. Colour tokens
Base foundation:
- background-ink: deep near-black navy for surfaces, e.g. #05070f.
- background-ink-2: slightly lifted surface for cards, e.g. #0c1120 / #101326.
- border-subtle: low-contrast borders, e.g. rgba(255,255,255,0.08).
- text-foreground: high-contrast surface text, not pure white where that blows out.
- text-muted: secondary text, date/time, labels.
- text-faint: tertiary text, disabled hints.

Accent (purple):
- accent: primary brand purple. Used for primary buttons, key highlights, active nav states, selected tabs, one or two secondary emphasis points. Not for every element.
- accent-soft: tinted surfaces/ribbons where purple is needed as a surface tint.
- accent-foreground: purple-on-purple text only where contrast allows.

Semantic (limited, clear):
- success: calm green, used for completion/positive states.
- warning: amber, used for cautions, pending, low-balance nudges.
- error: red, used for errors, destructive actions.
- Neutral system-colored semantic where appropriate for accessibility (e.g. focus ring).

Rule:
- Purple is the accent, not the entire palette.
- Semantic colours support meaning; they are not decoration.
- Never communicate a critical status through colour alone.

## 3. Typography
Type strategy:
- One strong display font for headings/titles where brand voice matters.
- Clean reading text for body.
- Monospace or tabular treatment for numbers/metrics when scanning matters.

Scale (relative, consistent):
- display: very large page/section hero titles.
- h1: screen title.
- h2: section header.
- h3: card title / sub-section.
- body: default reading size.
- body-sm / label: supporting text, captions, meta.
- metric: numeric values that users scan, e.g. credits, time, load.

Rules:
- Line heights are generous enough for readability on mobile.
- Titles have stronger weight; body text is regular weight.
- Numbers and costs are easy to scan; avoid 12px cramped money/credit figures.
- Long legal/content pages stay readable: comfortable measure, good contrast.

## 4. Spacing and layout
Spacing:
- Use a small, repeatable spacing unit. Avoid ad-hoc random pixels.
- Standard content padding for screens and cards.
- Section spacing larger than card padding.
- Consistent horizontal padding so narrow and wide screens both feel intentional.

Layout:
- Max content width on wider screens; centered.
- Mobile: full-width content with readable padding.
- Cards use consistent corner radius and internal padding.
- Avoid content touching edges; avoid cards drifting off-screen.

Rule:
- Same padding language on dashboard, training, market, profile, and modals.
- That is what makes the app feel like one app.

## 5. Components
Standard set:
- Button: primary, secondary, ghost; consistent sizes; clear pressed/disabled/loading.
- Input: label, value, hint, error; consistent heights and radii.
- Card: consistent padding, radius, surface, border, shadow only where useful.
- Badge: status/label chips; not overloaded.
- Nav / tabs: active state obvious; inactive states quiet.
- Dialog / bottom sheet: clear backdrop, padding, close affordance.
- Dropdown / select: predictable trigger, menu, focus, disabled.
- Tooltip: short, readable, accessible.
- Loading: skeleton or indeterminate state, not flickering or decorative.
- Empty states: honest, useful, not a decorative placeholder that pretends to be data.
- Error states: what happened, what to do next.

States:
- Default, hover (desktop), focus/visible focus, pressed, disabled, loading, error.
- Touch targets are comfortable.
- Icons have labels where they are interactive.

## 6. Icons
- One consistent icon family and stroke weight.
- Sizes are intentional: small labels, medium actions, large hero accents.
- No decorative icon soup.
- Interactive icons are labelled or have accessible text.

## 7. Navigation and hierarchy
Principles:
- Primary actions are obvious.
- Active page/tab is obvious.
- Secondary info does not compete with primary actions.
- Labels are plain-language for multi-sport athletes.
- Established journeys stay intact unless there is a real usability problem.

Dashboard priorities (what the app actually has):
- Today's training / next session.
- Plan progress.
- Relevant goals.
- Recent performance where available.
- Coach feedback / notifications where available.
- Shortcuts to frequent features.

Rule:
- Dashboard is informational, not a fake analytics wall.
- Empty states are honest.

## 8. Motion and polish
- Smooth tab transitions.
- Subtle button feedback.
- Consistent skeletons.
- Expandable sections with clear state changes.
- Light transitions between loading and completed states.
- Reduced motion respected where supported.
- Performance first; no heavy background effects.

## 9. Accessibility and responsiveness
- Contrast is readable.
- Text sizes are readable.
- Visible focus where supported.
- Form labels are clear.
- Errors are clear and actionable.
- Touch targets are usable.
- Status is not colour-only.
- Layouts fit narrow, tall, and wide screens.
- Mobile-first.
- Modals/overlays do not exceed viewport or get hidden behind keyboard.
- No horizontal overflow.

## 10. Out of scope for Prompt 5
- Business logic changes.
- Training calculations.
- Pricing/credit economics.
- Fabricated dashboard data.
- Full UI bug-fix pass (that is Prompt 6).
- Anything that breaks existing authentication, training, AI, Market or credit flows.

## 11. Working method
1. Establish tokens and shared components first.
2. Apply them to navigation shell and home dashboard.
3. Apply them to training/performance, AI, video analysis, Market.
4. Fix responsive defects and obvious accessibility issues.
5. Test build, type, lint, automated tests, and functional smoke across major flows.
