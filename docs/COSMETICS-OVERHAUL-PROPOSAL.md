# Vaylo Sports — Cosmetics Overhaul: Research, Strategy and Implementation Plan

**Date:** 2026-10-17 · **Status:** Research & planning only. No app code, DB or UI was modified for this document.

**Method:** Phase 1 findings were produced by reading the actual codebase and migrations (file/line references throughout). Phases 2–4 were researched with cited sources. Estimates are labelled **[estimate]**; verified facts are labelled **[verified]**.

---

## 1. Audit of the existing Cosmetics system

### 1.1 What actually exists today (verified)

Vaylo has far more cosmetics infrastructure than the tab suggests — the problem is not absence of features, it is fragmentation. There are **three separate cosmetic systems running in parallel** on **one currency**:

**A. Profile cosmetics** (`reward_definitions` → `user_rewards` → `user_profile_cosmetics`, one equip row with 6 slots: title/border/background/name_color/effect/badge) — [cosmetics.ts](src/lib/cosmetics.ts). Purchases and equips run exclusively through SECURITY DEFINER RPCs (`purchase_cosmetic`, `equip_cosmetic`, `unequip_cosmetic`) which read server-side prices, refuse badges (earn-only), require an active subscription for animated items, and enforce seasonal availability windows (migrations `20260921090500`, `20261017092000`). Coin ladder is rarity-based: common 150 / rare 400 / epic 900 / legendary 2400.

**B. Avatar cosmetics** (`avatar_items` → inventory, `avatar_catalog` → server-authoritative prices generated from the client catalogue by `scripts/gen-avatar-catalog-sql.cjs`) — **[verified] 177 items across 18 categories** ([avatarCatalog.ts](src/lib/avatarCatalog.ts)). Nine "identity" categories (body, skin tone, face, expression, hair ×3, eyes, brows, facial hair) are free; nine "shop" categories (outfits, pants, shoes, headgear, gloves, accessory, badge, background, pose) are paid. The renderer ([AvatarCharacter.tsx](src/components/avatar/AvatarCharacter.tsx)) is a genuine, polished **layered-2D SVG engine**: physique scaling by sport body type, 17 hairstyles, facial hair, blinking/idle breathing/swaying, victory/flex/sprint poses, auras, particle effects and trainer trails, and a fake-3D `rotateY` drag. It renders on Profile and PublicProfile.

**C. Earn paths (recent and growing):** `grant_cosmetic(source, milestone)` ledgered grants for plan completion / first log / streak milestones ([cosmetic_earn_grants migration](supabase/functions/_shared/../migrations) `20261017090000`); deterministic "surprise boxes" for streak/referral/challenge milestones ([rewardBoxes.ts](src/lib/rewardBoxes.ts), ladder 3/7/14/30/60/100 days); and (from yesterday's work) server-granted event-trophy badges for logged PB times, displayed in the Achievements screen's Trophy Case.

**Currency:** Coins. DB-authoritative 1 credit = 7.5 coins ([coins.ts](src/config/coins.ts)); bundles $2.99–$37.49 with a pricing-rule test; one-time $1.99 first-purchase bundle; periodic coin drip from logged sessions (`claim_session_coins`, weekly cap). Pricing is integrity-tested (`MONEY.md`, money mirror scripts).

**Purchase UX already exceeds the request:** the [Collection page](src/pages/Collection.tsx) is try-on-first with live profile preview, confirm step, in-page coin quick-buy and shortfall top-up; the [StyleTab](src/components/profile/StyleTab.tsx) adds collection progress + "complete your profile" cheapest-item suggestion; bundles (3) and seasonal windows exist on both client and server.

### 1.2 What is broken or missing (verified causes, not vibes)

1. **Discoverability failure.** The Market — the only place real money is spent on coins — contains **zero** links to cosmetics, the collection, or the avatar studio (grep across [Market.tsx](src/pages/Market.tsx) confirms). The bottom nav and quick actions contain none either. Avatar Studio and Collection are reachable only from the desktop sidebar and one personalised nav entry. On mobile (the APK), the primary ways in are buried in the Profile page.
2. **Three destinations, two data models, one identity.** Profile cosmetics (`reward_definitions`) and avatar items (`avatar_items`) use different tables, different price ladders (150/400/900/2400 vs 80–4500), different category systems and different shop UIs. No screen answers "show me everything I own." This is the single largest architectural defect.
3. **Cosmetics disappear after purchase.** Outside the profile card and PublicProfile, nothing in the app renders cosmetics: not the feed, not the dashboard, not share flows (verified: ShareActivityButton, DailyTrainingCard, QuickActionSheet have no cosmetic rendering). The system's best asset — the animated avatar — is effectively invisible.
4. **Free tier is thin on profile cosmetics.** Avatar identity customisation is genuinely free and rich, but the *prestige* layer (titles/borders/effects) is coin-only; earn-grants exist but are random-pool and invisible until claimed.
5. **Trophy Room and Cosmetics barely touch.** The Trophy Room (Achievements/Badges/Challenges screens + the new Trophy Case) shows no owned/equipped cosmetics, no collection milestones, no sets. Badges were literally unearnable before October's grant RPC.
6. **No content cadence.** Three bundles, seasonal window flags with two known legacy defect rows ([cosmeticCatalog.ts](src/lib/cosmeticCatalog.ts) comment), no seasonal drops, no sets, no new-item pipeline. Nothing gives a reason to come back next month.
7. **No social loop.** No "share my look", no lookbook, no opponent-profile comparison, no outfit presets.

### 1.3 What to reuse rather than rebuild (answer: nearly everything)

Keep: both RPC families, `reward_definitions`/`user_rewards` (badges/titles/trophies), `avatar_items`/`avatar_catalog`, the SVG avatar engine, the Collection try-on pattern, the StyleTab suggestions, coins + bundles + drip, reward boxes, grant RPC, event trophies, PublicProfile. The overhaul is **consolidation + connection + cadence**, not new foundations.

---

## 2. Competitor research (phases 2 report)

Full source-backed report produced by the web-research agents; condensed here with sources.

| Product | Mechanism that works | Evidence | Verdict for Vaylo |
|---|---|---|---|
| **Strava** | Identity built from *real activity*; verified pro badges; Trophy Case of challenge badges; gear as functional-cosmetic | [verified pro badge criteria](https://verified.strava.com/apply/pros); [Trophy Case](https://support.strava.com/en-us/articles/15402068-the-strava-trophy-case) | Mirror: earned cosmetics outrank bought ones; display gear instead of generic bling |
| **Nike Run Club** | Recognition for *personal improvement* (PRs, streaks, monthly goals) with trophies + community high-fives; no paywall on identity | [NRC](https://www.nike.com/nrc-app) | Mirror: free cosmetics for milestones should feel generous |
| **Duolingo** | XP/streak/leagues with opt-out leaderboards; milestone membership (Streak Society); collectible achievement badges on profile | [leagues](https://blog.duolingo.com/duolingo-leagues-leaderboards/); [badges](https://blog.duolingo.com/achievement-badges/) | Mirror the *ladder + organisational record*, avoid punitive streak loss |
| **Roblox** | Desire = self-expression + scarcity + creator economy; ~40% of MAU visit marketplace monthly; brand limiteds (Adidas packs 85–500 Robux) with resale economics | [Roblox economy](https://about.roblox.com/newsroom/2023/07/vision-roblox-economy); [Adidas collab](https://fashionunited.in/news/fashion/adidas-launches-digital-products-on-roblox/2023120742734) | Take: chapter/brand-style collabs later. **Reject: resale market, opaque limiteds** |
| **Snapchat Bitmoji** | Quality free closet + saved outfits; shoppable items gated | [outfits](https://support.bitmoji.com/hc/en-us/articles/360037603511-Change-my-Bitmoji-Outfit) | Mirror: outfit presets must be free |
| **Fortnite** | Pass cosmetics from activity XP; **returns ≥18 months later**, so "limited" is honest urgency, not fake scarcity | [Epic pass docs](https://www.epicgames.com/help/c-34254770/c-33726977/understanding-the-fortnite-battle-pass-lego-pass-og-pass-and-music-pass-a20455513) | Seasonal sets OK if they return; never expires-threaten |

**Differentiation for Vaylo:** every competitor rewards *activity_VOLUME or platform activity*; Vaylo can reward **sport-specific PBs, consistency and mastery** (the event-trophy system already does this server-side), and can display cosmetics **on real training data** — the avatar celebrating *your* 5K gold time is a mechanic none of these apps has.

**Unsuitable for an athlete-focused youth app:** loot boxes/paid randomness, FOMO-clocked urgency on purchases, streak-shaming, anything implying buying = better athlete.

### 2.1 The seven research questions, answered explicitly

1. **What makes users want to customise?** Expression + identity-as-record: Strava's activity-built profile; Roblox's ongoing avatar project; Bitmoji's closet-as-ritual. For Vaylo: the avatar is a *training record you wear*, not a doll.
2. **What makes items desirable/prestigious?** Scarcity + provenance + difficulty: Strava's verified badge (earned, not bought), Roblox limiteds, Duolingo's Diamond league membership. For Vaylo: **provenance is the prestige axis** — earned chips outrank coin chips in every display we build.
3. **How do progression/rarity/limited-time affect engagement?** Duolingo's weekly league retention engine; Fortnite seasonal XP; Roblox's monthly-marketplace visit stat (40% of MAU). For Vaylo: seasons + sets give the cadence; rarity gives the chase; **both must re-enter availability later** (§7) to stay honest.
4. **How are free users motivated?** NRC gives trophies for personal improvement free; Bitmoji's free quality is the floor; Fortnite's pass includes free-lane rewards. For Vaylo: 1 free item/set minimum + full free identity customisation + generous feed renders of *their* earned moments.
5. **What purchase encouragement avoids pay-to-win?** All six studied products confine purchases to expression. For Vaylo: expression-only is structurally guaranteed (cosmetics never touch credits/features — [verified] purchase RPC refuses non-cosmetic escalations, credits and unlocks are separate catalogues).
6. **Which strategies realistically work for Vaylo?** Seasons/sets, earned-collection prestige, sport-locked kits, feed-visible avatars, provenance chips, quality free closet — all P1/P2 below.
7. **Which are unsuitable?** Resale markets (Roblox), creator-economy marketplace economics (ongoing ops burden, moderation risk), leagues that rank cosmetic spend, gifting economies, brand-licensing before product-market fit of the basics. Each is listed in §10 P3 only with explicit gates or rejected outright.

---

## 3. 3D avatar system — recommendation: **do not build it now**

The premise of the request assumed no avatar system exists. **[verified] One already exists** — the SVG engine above — and its quality ceiling is *art polish*, not technology. Research on the 3D alternative:

- R3F adds ~237 KB gzipped (three 180.6 + fiber 56.3) before models/textures; Android WebView WebGL performance is device-dependent with no defensible universal FPS figure ([MDN WebGL2](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext), [R3F](https://r3f.docs.pmnd.rs/getting-started/introduction)).
- Commissioned stylised 3D characters with interchangeable hair/outfits run **$2,000–$8,000+ [estimate]** plus 3–8 weeks engineering; off-the-shelf packs (e.g. Synty Sidekick ~£183) need adaptation work outside their native engines ([price guide](https://rocketbrush.com/blog/3d-character-art-prices-guide), [Synty](https://syntystore.com/products/modern-civilians-sidekick-modular-characters)).
- Duolingo deliberately ships a flat vector avatar creator with Rive animation for exactly this reason ([avatar creator](https://blog.duolingo.com/avatar-creator/)).

**Verdict:** A webview APK is the wrong place for a first WebGL character; it risks mid-range phones, adds a second art pipeline, and buys little over the existing animated SVG avatar. **Reinvest that budget in (a) art polish of the existing SVG avatar, (b) outfit/system variety, (c) the social surfaces that make cosmetics visible.** Re-evaluate real 3D only if/when the app ships a native (non-webview) renderer or the athlete-facing interview data says players want rotation/3D specifically. A one-week 3D *prototype benchmarked on three target phones* is the cheapest honest test if leadership still wants it [estimate].

---

## 4. Photo-based AI avatars — recommendation: **attribute detection, not image generation, at launch**

Two viable approaches (researched):

1. **Full image generation** (OpenAI `gpt-image-1` ~$0.02–0.19/image at low–high quality; Google Flash Image ~$0.034–0.067/1K image [sources: openai.com image-generation-api, ai.google.dev pricing]). Latency 15–60s [estimate]. Real failure modes: unrecognisable likeness, uncanny output, moderation rejections, inconsistent retries. **Privacy exposure:** provider abuse-monitoring retains content up to 30 days ([OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)); COPPA treats child photos as personal info requiring verifiable parental consent and retention limits ([FTC FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions), [2025 amendments](https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data)); GDPR-K consent ages vary 13–16; UK ICO Children's Code requires data minimisation ([ICO](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/childrens-information/childrens-code-guidance-and-resources/age-appropriate-design-a-code-of-practice-for-online-services/)).
2. **Attribute detection → component assembly** (recommended): one small vision-model call (GPT-4o-mini-class: $0.15/$0.60 per M tokens ⇒ **~$0.0002–0.002/photo [estimate]**) extracts hair style/length/colour, skin tone, glasses, beard, accessories; the app then equips mapping catalog items — no image generation, no likeness stored, output is fully editable with existing free tools, cost per conversion is ~**100× cheaper**. Precedent: Meta offers both "create from selfie" and manual creation ([Meta avatar help](https://www.meta.com/help/connected-experiences/3531951367126680/)); launching detection-only matches ICO minimisation.

**Safety requirements either way:** optional feature; consent + plain-language third-party disclosure; parent/guardian flow for under-13/under-consent-age users; client-side crop/compress + EXIF strip; photo held in memory only or deleted after the call; no logging of image payloads; user can delete the derived avatar; never expose traits the model guessed as facts (especially skin shade — present as an editable choice, never infer labels). Vaylo already has the legal scaffolding (consent lib, safety pages, age gates) to host this flow.

---

## 5. Cosmetics inside the athlete's journey (Phase 5 design)

Principle: **earned first, bought second, both visible everywhere.**

1. **Wardrobe moments.** The event-trophy grant (already live server-side) becomes a *moment*: when a Gold time arrives, the avatar appears in the celebration wearing/wearing the matching colour collection. Season collections themed to the event ladder (e.g. "Championship Gold", "Trail Autumn").
2. **Set collection, not single items.** 4 seasonal sets/year, each 4–6 items (an outfit, a backdrop, a title, an effect). Completion bonus item is **earned** (set badge), never sold. Sets have progress in the Trophy Room (§6).
3. **Consistency without volume-pressure.** Reward sessions logged (any duration), rest days honoured (Recovery green days), and learning/mental modules completed — mirroring the existing achievement counters (workouts, checkins, greenDays, reviews, mentalCheckins already exist in [achievements.ts](src/lib/achievements.ts)). **Do not** scale rewards with distance/time volume beyond the existing weekly coin drip cap; the drip already solves the "reward" problem without encouraging overtraining.
4. **Sport identity.** Sport-locked weekly challenges (verified against the athlete's logged sports — the same gating the Trophy Case uses) unlock sport kit sets. A footballer can't buy the Marathoner set with money; they earn it or don't. Sport-specific = meaningful, and self-gating by sport fixes unfairness.
5. **Social identity.** Lookbook (save 3 outfit presets — free), "share my look" (share sheet already exists), opponent profiles show equipped cosmetics, and the feed renders the avatar's celebration when a trophy drops (FeedShareActivityButton extension).
6. **Clear labelling.** Every item carries one of three provenance chips — **Earned** (trophy/streak/challenge), **Free** (identity/starters/boxes), **Coins** (purchased) — building directly on the existing `ownedSourceById` data.
7. **Avatar progression — visible athletic development [verified foundation exists].** The avatar loadout already carries a `prestige_level` field ([AvatarLoadout](src/components/avatar/AvatarCharacter.tsx)) and categories are sport-bodied (Distance Runner/Sprinter/Swimmer frames). Proposal: tie an emblem slot + frame colour to a **single-volume-agnostic level** (percentage of consistent weeks logged in the last quarter, capped so nothing accrues faster for high-volume athletes). Every 90 days the athlete picks an achievement frame (their best event-trophy tier) — the avatar visibly “ages into” their record without rewarding mileage. Never display the number on shared surfaces; display only the frame.
8. **Learning + mental-training rewards — concrete.** The existing counters (`reviews`, `mentalCheckins`, `cueWords`) already track module completion [verified]. Proposal: completing a learning module’s month earns one **earned-tier item** from the seasonal set (chosen from 2 offered, random mitigated by a deterministic pick so no reroll-farming) mirrored by an achievement. Mental-training check-in streaks of 14/30 days earn the calm-themed accents (aura/breathing effect). No module is *required* to complete any set — these feed it, they don’t gate it.
9. **Daily/weekly engagement that adds value, not chores.** The only recurring cosmetic touchpoint is the Sunday recap card: wears-season progress + “your look from this week’s training” render (one SVG render, cached) + one affirmation of free items available. No daily login rewards, no energy systems. If a week is missed: nothing decays, nothing shames.
10. **Anti-unhealthy-shape guards.** Item unlock text references consistency and mastery, never volume; motion-free celebrations for rest-day milestones (greenRestPennant) are explicitly equal in prestige to speed milestones — art direction rule, not copywriterafterthought.

---

## 6. Trophy Room integration plan (stays separate — phases 6 report)

**The Trophy Room remains Achievements / Badges / Challenges / Trophy Case.** Cosmetics integrate as *display*, not merged inventory:

- **One source of truth.** Cosmetic ownership already lives in `user_rewards` (+`avatar_items`) with provenance. The Trophy Room *reads*; it never duplicates. A cosmetic earns a Trophy Room presence exactly when it already earns a `reward_definitions` badge — the event-trophy pattern generalises: **set completion = an auto-granted `reward_definitions` badge of category `collection_set`** with payload `{set_id, tier}`.
- **New "Collections" shelf in the Trophy Room** (fourth tab, read-only): one card per seasonal/sport set, showing owned/total, the completion badge state, and a tap-through to the Cosmetics tab for the missing pieces. Nothing is purchasable from the Trophy Room (it stays "nothing here is bought").
- **Synchronisation:** no new ownership tables. The only new data is metadata (`collectible_sets`, `collectible_set_items` — definitions-only tables, RLS read-only) and the existing idempotent grant RPC extended with a `set_complete` source. Completion checks run server-side in the same claim RPC family, keeping grants tamper-proof.
- **Premium display environment:** the shelf renders the SVG avatar engine's item previews (the engine already renders every item type) — high polish for near-zero marginal cost.

---

## 7. Sustainable cosmetic economy (phases 7 report)

**Verified baseline:** coins-only premium purchases; no real-money cosmetics; subscription gates animated items; no loot boxes anywhere (reward boxes are deterministic and free); purchase confirmations + disclaimers in both shops; coin drip weekly-capped. This is an unusually ethical foundation — **keep every rule below intact.**

| Lever | Current | Change |
|---|---|---|
| Free cosmetics | 9 identity categories free; boxes random | Keep; add **free seasonal item per set** (1 of 4–6) so free users complete 1 item/set minimum |
| Direct purchase | coin ladder per rarity | Keep; add **set bundles** (existing bundle RPC already supports multi-item) |
| Earned cosmetics | grants + boxes + trophies | Prioritise: seasonal set completion badges; sport sets; PB-trophy sets |
| Limited-time | seasonal windows | Keep windows honest: **items return in later seasons** (Fortnite ≥18-month rule) — scarcity is participation, not fear |
| Preview | Collection try-on exists | Extend to avatar studio + new Cosmetics tab; **all previews free** |
| Subscriptions | animated-item gate | Add: subscribers earn a monthly member badge & drip bonus (cosmetic-only; no pay-to-win) |
| Pricing | $2.99–$37.49 bundles; tested ladder | Unchanged. Target: cosmetic spend ≈ 300–900 coins/set ⇒ a set costs **$1.20–$3.50 [estimate]** — pocket money for a teen, well under credit-pack economics |
| Anti-pressure | disclaimers, no urgency anywhere | Codify as a rule + test: **any expiring-clock/urgency mechanism on cosmetic purchase surfaces is a defect** (extend `offerVisibility.test.ts`) |

**What we will not do:** paid loot boxes, resale markets, expiring-owned items, real-money-only cosmetics, purchase-pressure cadences, anything monetising training volume.

### 7.1 Payment-stack dependencies (verified)

- **Today [verified]:** every purchase goes to the `process-purchase` edge function, which grants credits/coins/unlocks server-side after server-side price reads ([billing.ts](src/lib/billing.ts)). Coin bundles are therefore already purchasable on web end-to-end.
- **Play Billing [verified, not live]:** the Capacitor/Android path is scaffolded — `billing.ts` routes store purchases through Play Billing + a server token verifier (`supabase/functions/_shared/playBilling.ts`), but `STORE_BILLING_ENABLED = false`. **Dependency for Android cosmetic revenue: shipping that seam is a prerequisite**; until it ships, coin purchases on the APK cannot complete. Google requires digital goods to use Play Billing — coins sold for real money in the APK must follow it.
- **Cosmetics themselves** never need new payment rails: they are priced entirely in coins, so every cosmetic monetisation feature in this plan rides the existing coin bundle + process-purchase + drip infrastructure. Nothing in P1/P2 touches billing code.

---

## 8. User experience (Phase 8 proposal)

**One destination: the Cosmetics tab** (collected under Profile, linked from Market and the bottom-sheet quick actions — fixing the discoverability defect). Three sections, one backbone (the **live avatar + profile card preview** stays on screen):

1. **You** — avatar quick-edit (identity categories, free) + outfit preset switcher.
2. **Discover** — carousel: *New this season* → *Recommended for you* (sport-aware, from owned gaps) → *Sets with progress* → *Bundles*. Try-on-first on everything (the Collection pattern generalises).
3. **Closet** — everything owned across BOTH inventories, one grid, provenance chips, filters (type/rarity/provenance/season), search. Rarity shows actual completion context ("2 of 6 owned in Championship Gold").

**Item detail = the polish moment:** full avatar render isolated on dark navy with the item equipped, before/after toggle, price or provenance, one-tap equip, free/locked state clear. Web + APK responsive via existing Tailwind patterns; no new navigation framework.

**Mapped journey (example):** Log 5K → PB card shows Bronze trophy (existing) → toast links to Trophy Case → Collections shelf shows "Championship Gold 2/6" → Cosmetics tab deep-link lands on the set → free item + two affordable coins → buy → try-on equips instantly → share card auto-includes new look.

### 8.1 Interface sketch — the Cosmetics tab (dark navy palette, purple accents)

```
┌────────────────────────────────────────────┐
│  Cosmetics                     [❖ 480]     │  ← sticky coin chip (from coins.ts)
│                                            │
│  ┌────────┐  ← live avatar (AvatarCharacter,│
│  │ avatar │     idle animation, drag=rotate)│
│  │ +card  │     equipped profile cosmetics   │
│  └────────┘     rendered underneath [verified│
│                 pattern from Collection.tsx] │
│  [ You  Discover  Closet ]  ← 3 segments    │
│────────────────────────────────────────────│
│  Discover:                                  │
│  ─ New this season ── Championship Gold ──  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ item  ▦  │ │ item  ▦  │ │ item ▦   │    │  ← try-on tap → avatar updates
│  │ 400 ◉    │ │ 900 ◉    │ │ EARNED   │    │     live; confirm on press
│  └──────────┘ └──────────┘ └──────────┘    │
│  Progress: ▓▓▓░░ 2/6 · set badge: locked    │
│  ─ For you ─ (sport-aware, from owned gaps) │
│  ─ Bundles ─ (cosmeticCatalog.ts mirror)    │
│  Closet: grid ▢▢▢▢ / filters: type · rarity │
│  · provenance (★earned ☆free ◉coins) · set  │
│  · search                                   │
└────────────────────────────────────────────┘
```
Item detail (bottom sheet): full avatar isolated on black, before/after toggle, provenance chip, price/provenance, Equip/Buy. All previews free.

### 8.2 Sample season set — "Championship Gold" (illustrative content, prices on the verified ladder)

| Slot | Item | Source |
|---|---|---|
| Title | "Championship Runner" | Coins (400, rare) |
| Outfit | Gold-trim race kit (avatar category `outfit`) | Coins (700, epic) |
| Backdrop | Podium Dusk (profile `background`) | **Free** (1 per set by design) |
| Effect | Gold confetti burst (profile `effect`, animated) | Coins (900, epic; subscription-gated as animated) |
| Set badge | `collection_set.championship_gold` — "Set complete" | **Earned only** (never sold) |

Differentiators sketch: the effect renders *with the trophy moment* (see §5.1); the badge lives in the Trophy Room with the same art.

### 8.3 Example user journeys (three shapes)

**Journey A — free teen, day 1:** onboarding → Avatar Studio → free identity pass (rich [verified]) → picks a free seasonal item from the Discover rail → first session logged → first_log grant → closet shows ★ Earned chip → returns next week to claim the 3-day streak box.

**Journey B — paying athlete, mid-season:** logs 5K PB → Bronze trophy (existing flow) → Trophy Case → "Championship Gold 2/6" → buys 2 set items (~1,100 coins ≈ $6 wallet-and-up [verified bundle ladder]) → try-on equip → shares the celebration card to a friend group — the loop from first touch to spend is ≤3 taps from any training milestone.

**Journey C — casual, came for plans:** completes a training plan → plan_complete grant [verified] → achievement + earned item unlocked → Cosmetics tab surfaces the matching collection, not a paywall. Nothing about the journey demands return visits, yet set progress gives one.

---

## 9. Technical architecture (Phase 9 — grounded in the actual codebase)

**Reuse (no migration needed):** coins RPCs; `purchase_cosmetic`/`purchase_cosmetic_bundle`/`purchase_avatar_item_coins`; `equip_cosmetic`/`unequip_cosmetic`; `grant_cosmetic`; `claim_event_trophies`; seasonal-window parity (client + server already mirrored); Collection/StyleTab components; PublicProfile; the SVG engine; the money-mirror test rig.

**New (all small):**
- **Data:** `collectible_sets` + `collectible_set_items` (definition tables, RLS public-read); extend `reward_definitions.category` enum with `collection_set`; tag existing items with set membership (`season` column already exists).
- **RPC:** `claim_set_completion(p_set_id)` — idempotent, same SECURITY DEFINER pattern as the event-trophy grant.
- **Client:** `Cosmetics.tsx` route + nav entries (Profile tab, Market section card, sidebar); `useAllCosmetics` hook unifying `useCosmetics` + avatar inventory reads (both tables by RLS owner-read — safe); provenance chip component; Trophy Room Collections shelf; set progress hook.
- **Rendering:** zero — reuse AvatarCharacter; static SVG item previews.
- **AI (later):** one edge function `avatar-from-photo` following the existing `_shared/openai.ts` vision path, attribute→catalog-id mapping table, images never persisted, config-flagged off by default.

**Performance & mobile:** the avatar engine is already text-SVG (no asset downloads, no WebGL); new surfaces are DOM-only. Failure points to test: RLS on new tables (public-read definitions), idempotency under double-claim, offline queue recovery, APK webview layout heights (the safe-area shell tests exist — extend them).

### 9.1 Authentication, authorisation and data security (explicit)

- **Ownership & equip arity [verified to already hold]:** every cosmetic read/write is AUTH-only RLS on owner rows (`user_rewards_owner_read`/`owner_equip`; similar on `avatar_items`, `user_profile_cosmetics`); writes to ownership/equipped states travel only through SECURITY DEFINER RPCs — the client cannot claim/set members of new features without the server verifying entitlement and milestone (public tables are definitions-only).
- **New tables inherit that pattern:** `collectible_sets`/`collectible_set_items` are public-read, service_role-write; the completion claim re-queries the caller's real inventory server-side, never a client-supplied count; idempotent via the same UNIQUE/ON CONFLICT + ledger pattern as the event-trophy and earn-grant RPCs [verified patterns].
- **Photo feature (P3) security posture**, regardless of aetiology: TLS only, cropped/compressed + EXIF-stripped, in-memory or deleted after the call, no image payload logged, avatar deletable, no public sharing by default, parental consent where applicable.
- **Secrets:** no new keys in P1; the P3 vision path reuses the existing OpenAI secret already held by edge functions [verified `_shared/openai.ts` infrastructure].

### 9.2 Testing requirements (grounded in the repo's test rig)

Existing rig: vitest unit tests + repo-wide typecheck, plus pricing/economy integrity tests (money mirror, offer visibility, plan/e2e scripts). New test surface: seasonal-window parity (extend `cosmeticCatalog`-style tests), bundle economics honesty, set-completion idempotency (SQL-level test via the event-trophy pattern), provenance-chip correctness (edge cases: owned-by-two-epochs), RLS exposure audit script coverage for the two new tables, and safety tests for the anti-urgency rule (a grep-style test asserting no `countdown|expiring|ending soon` strings on cosmetic surfaces — mirrors the existing `overflowLayout`/`safetyCompliance` test style). APK: smoke through the Capacitor build + a low-end device matrix check (the AVD set used by `android-release.yml` [verified workflow exists]).

**Estimates [estimate]:** P1 consolidation ≈ 2–3 dev-weeks, zero new infrastructure cost. Season content pipeline ≈ 0.5 dev-week/season + art (SVG edits are cheap). Attribute-detect feature ≈ 1 dev-week + <$5/month API until >10K conversions. Full 3D (if ever) ≈ $2–8K art + 3–8 weeks engineering (per §3 sources).

---

## 10. Prioritised roadmap

### Priority 1 — Essential (fixes the tab; MVP of this overhaul)
1. **Unify discovery:** Market section card + Profile tab + entry points; move reward boxes into the single tab.
2. **One Closet:** unified owned-inventory screen across `user_rewards` + `avatar_items` with provenance chips.
3. **Try-on everywhere:** item detail/tap preview standardised on the Collection pattern.
4. **Sets metadata + Trophy Room Collections shelf (read-only).**
5. **Free seasonal item per set** + earned set-completion badge.
6. **Share-a-look card** (reuses share sheet).
7. **Content seed:** one complete season set (4–5 items) shipped as migration data.
8. **Ethics codified:** urgency/pressure test extends to all cosmetic surfaces.

*Problem solved:* everything in §1.2. *Impact [estimate]:* dwell/usage of cosmetics surfaces, first cosmetic conversion rate, drip-coin sink activation. *Success metrics:* % DAU visiting Cosmetics tab; conversion rate from try-on→equip→buy; set completion rate; coins spent/set; zero urgency-mechanism violations in tests.

### Priority 2 — High impact
For each feature (problem → why users care → impact/complexity/cost [estimate] → dependencies → risk → measurement):

| Feature | Problem it solves | Why users care | Impact | Complexity / cost | Depends on | Risk | Metric |
|---|---|---|---|---|---|---|---|
| Sport-locked seasonal sets + weekly sport challenges | Generic global drops feel irrelevant to an athlete's sport | Identity in *their* sport (a runner earns runner gear) | High retention of weekly challenge participants | Med / 1.5 dev-week + art | P1 sets; sports derived from logged sports | Wrong sport guessed for multisport athletes → allow opt-in selection | Sport-challenge participation→set completion % |
| Lookbook presets + public lookbook | No way to toggle roles/looks quickly; expression stalls | Show different identity for race day vs rest day | Med-high on repeat customisation | Med / 1 dev-week | P1 closet | Profile-surface mismatch when swapping (state-sync bugs) — restrict presets to avatar items only (not profile cosmetics) first | Presets created; preset switches/user/wk |
| Feed/share avatar-celebration rendering | Purchases invisible to peers ⇒ no desire loop | Social proof + pride of earned items | **Highest** purchase-intent driver across research | Med / 1–1.5 dev-week | P1 equipped-state hook | Peer-pressure risk → keep renders achievement-anchored, never stockpile-flexing | Share-card sends; view→visit→purchase funnel |
| Subscriber monthly badge + drip bonus | Subscribers currently get only the animated-item gate — thin benefit | Members want a visible marker that isn't "power" | Med on sub retention | Low / 0.5 dev-week | grant RPC family; subscription ledger [verified] | Exclusivity inflation → keep tier modest (rare, not legendary) | Sub badge equip rate; churn delta vs cohort |
| Recommended-for-you | Closet/Discover becomes a wall after 2 sets | “What genuinely fits me” — ranked by owned gaps + sport, zero urgency | Med (navigation to purchase, not Manufactured Demand) | Med / 1 dev-week | P1 closet + sports | Feedback loops can narrow discovery → cap rec surfacing, refresh weekly | Rec→detail view→purchase conversion |

### Priority 3 — Advanced (gated; each needs its own business case)
Same fields, + the explicit gate:

| Feature | Problem / why users care | Impact | Complexity / cost | Gate (why not now) | Risk | Metric if ever shipped |
|---|---|---|---|---|---|---|
| Attribute-detect photo avatar (§4) | Customisation start is manual; “looks like me” is the strongest identity driver in avatar products (Meta precedent) | Potentially transformational for first-run identity | Med / 1 dev-week + <$5/mo API [estimate] | Needs legal sign-off on minors’ consent flow per region (§12c) — investigate first | Likeness-adjacent data handling under COPPA/GDPR-K; model misguess → trait-confirmation step, editable defaults | % new users using it; edit-from-detection rate |
| Full image-gen “creative portrait” | Unrecognisable likeness risk + 30-day provider retention | Speculative | Med-high | Recommend against at P3; revisit only as opt-in creative feature with parental disclosure | Uncanny output; moderation | If shipped: opt-in rate + delete rate (expect churn) |
| 3D avatar (§3) | Not solved by 2.5D SVG polish alone (gesture/rotate depth) | Unknown until measured | $2–8K art + 3–8 wks eng | Only after the 1-week prototype benchmark on 3 target phones; native shell prerequisite | Weak mid-range devices; double art pipeline | Prototype FPS P50/P95 on target phones |
| Brand/club collabs (Roblox-adidas model) | Freshness without in-house art debt | Speculative for a niche sports app | Budget-scale [estimate] | Only with visible licensing budget + per-collab ethics + COPPA review for youth-facing advertising | Youth-advertising rules; vendor lock | Collab redemption vs house-set engagement delta |

---

## 11. The five highest-impact changes to make first

1. **Unify discovery + one Closet** (Market/Profile/sidebar entry points, merged inventory with provenance chips) — solves the fragmentation that currently makes the tab feel pointless.
2. **One complete season set with a free item + earned completion badge** (#1 + migration seed) — creates the missing return-visit loop and the first true earned-prestige item.
3. **Trophy Room Collections shelf** (read-only, server-computed completion badges) — connects Cosmetics to the Trophy Room without merging them.
4. **Feed/share rendering of the avatar + equipped cosmetics** — makes purchases *visible* to peers, the single biggest desire-driver across every researched competitor.
5. **Sport-locked event-trophy collections** (extends yesterday's `claim_event_trophies` pattern to a themed set per sport ladder) — Vaylo's differentiator no competitor has: collections you *earn by running, not by paying*.

---

## 12. Assumptions, unresolved questions and risks

**Assumptions [estimate unless noted]:** coin economy pricing ($/coin ladder) stays as configured; seasonal windows follow the Fortnite-returns model; sample-set prices (300–900 coins) are acceptable to the target audience (validate in closed testing); the App Store/Play policies treat cosmetic-only purchases as low-risk (paid randomized items would not be).

**Unresolved questions:** (a) does the APK webview hold 60fps try-on animations on low-end devices — measure; (b) minimum set size for completion satisfaction — propose 4, validate; (c) underage consent flow details per region for photo features (EU GDPR-K ages vary 13–16 — needs a legal sign-off before any photo feature); (d) whether the *existing* 2-defect seasonal rows (windowless `seasonal`) are the only debt of that kind (audit all rows before P1); (e) event-trophy reuse for set gating — today's grant RPC assumes one log per claim; sport-set weekly gating needs a distinct claim cadence.

**Risks:** fragmentation worsens if P1 ships without retiring the standalone sheets (decide: CosmeticShop bottom sheet becomes a thin wrapper over the new tab); SVG art debt grows linearly with new items (budget art review each season); social cosmetics always risk peer pressure among teens — mitigations: provenance honesty (earned beats bought), no public ownership-rank displays, no gifting/leaderboards over cosmetics spend; attribution of revenue to this work is diffuse — instrument *before*, not after, P1.
