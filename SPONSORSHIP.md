# Sponsorship and brand advertising (in-app side)

Companion to the brand-facing site, which is a separate codebase. This document
covers **what the app does with a brand** once one has been signed up: where
sponsors can appear, what is enforced, and how to add one.

Migration: `supabase/migrations/20260921090700_sponsored_age_gate.sql`.

---

## 1. The rule: sponsored content is 18+ only, enforced in the database

VAYLO's athletes span roughly 12–30, so the app must never show a minor a
sponsored placement. That is enforced server-side, not in the client, because a
client check is bypassed by a console command or a raw API call and this is the
one area where getting it wrong is a legal problem (UK Age Appropriate Design
Code / GDPR-K, COPPA, and both stores' advertising rules for children).

`public.viewer_is_adult()` derives adult status from the athlete's **own**
`profiles.date_of_birth` at read time:

- no date of birth (the state of every existing athlete) ⇒ **not an adult**,
- adult status arrives on the athlete's 18th birthday with no data migration,
- there is no stored flag to flip, so no client can promote itself.

It is used in two places:

| Surface | Enforcement |
|---|---|
| Sponsored placements | `sponsored_placements()` returns an empty set for minors — the function is the only read path, and the underlying tables are not granted to any client role |
| Sponsored challenges | the `challenges` SELECT policy hides rows with a `sponsor_brand_id` from under-18s; ordinary challenges are unaffected |

Onboarding now asks for a date of birth (`/onboarding`, step "When were you
born?"). It is optional: skipping it means ad-free, which is the safe default.
It can be changed later in Profile → Edit profile.

**Known limitation:** age is self-declared. An athlete who lies about their date
of birth will be treated as an adult. That is true of every age gate, but worth
repeating before a deal promises under-18 protection. If a brand requires
stronger assurance, the next step is an age-estimation/verification provider —
a decision, not a code change.

---

## 2. Where sponsors can appear

`brand_placements.placement` is whitelisted to four values:

| Placement | Status |
|---|---|
| `challenge` | **Wired** — `SponsoredSlot` on the Challenges page, plus a disclosure chip on sponsored challenge cards |
| `learning` | Slot component ready (`<SponsoredSlot placement="learning" />`); not yet placed on a page |
| `post_session` | Slot component ready; not yet placed on a page |
| `ai_slot` | **Data model only.** Rows can exist and are served to adults, but no AI function reads them yet — "AI preference for your brand" is not implemented |

Anything else returns nothing. Every served card carries a disclosure label
(`brand_placements.disclosure_label`, default `Sponsored`), shown as
`Sponsored · <Brand>` — required, not decorative, and tunable per deal.

---

## 3. Adding a brand

Brands and placements are deliberately readable **only** by the service role:
`brands` holds your contracted price and internal notes, and no client needs to
enumerate who you are talking to. Add rows in Supabase Studio (Table editor or
SQL) or with an admin edge function.

```sql
-- 1. The brand
insert into public.brands (name, slug, logo_url, website, contact_email, status,
                           contract_price_cents, contract_currency, notes)
values ('Example Athletic', 'example-athletic', 'https://…/logo.png',
        'https://example-athletic.com', 'partners@example.com', 'active',
        250000, 'GBP', 'Custom brand challenge + 4-week learning slot, invoiced quarterly');

-- 2. A placement (headline/body/CTA only — no price data reaches the app)
insert into public.brand_placements
  (brand_id, placement, headline, body, cta_label, cta_url,
   sports, regions, starts_at, ends_at, weight, disclosure_label)
select id, 'challenge',
       'Fuel your sessions with Example Athletic',
       'Hydration designed for training blocks like yours.',
       'See the range', 'https://example-athletic.com/range',
       array['Running','Cycling'], array['GB'], now(), now() + interval '8 weeks',
       10, 'Sponsored'
from public.brands where slug = 'example-athletic';
```

`status = 'active'` **and** `active = true` are both required for delivery, so
pausing a deal is one column. `sports`/`regions` empty means "everyone".

### Sponsored challenges

A brand challenge is an ordinary challenge with a sponsor attached:

```sql
update public.challenges
set sponsor_brand_id = (select id from public.brands where slug = 'example-athletic'),
    sponsor_name = 'Example Athletic',
    sponsor_disclosure = 'Sponsored',
    scope = 'monthly',
    is_official = true
where id = '<challenge-uuid>';
```

The challenge card then shows the disclosure chip, and the row disappears for
under-18s automatically.

---

## 4. Reporting

`brand_metrics` keeps aggregate counters only — one row per placement, day and
kind (`impression` / `click`), written by `record_brand_event()`. There is **no
user_id**: you can report reach to a brand without building a behavioural ad
profile of a minor, and no brand ever receives athlete-level data or training
data.

```sql
select placement_id, day, sum(count) filter (where kind = 'impression') as impressions,
       sum(count) filter (where kind = 'click') as clicks
from public.brand_metrics group by 1, 2 order by 2 desc;
```

The counter only accepts a placement that is currently servable, so a crafted
request cannot inflate a report for an ended campaign.

---

## 5. Pricing

You set brand prices yourself, and they stay **out of the app's money model**.
Do not add them to `src/config/credits.ts`, `coins.ts` or `monetisation.ts`:
`scripts/gen-money-mirror.cjs` mirrors that catalog into the edge function and
enforces the credit-pack/coin-ladder invariants, so brand pricing there would
either break the build's assumptions or ship your contract terms in the client
bundle. Contract value lives in `brands.contract_price_cents` for invoicing.

Brand deals are invoices, not in-app purchases, so Apple/Google billing rules do
not apply to them.

---

## 6. Not built yet (deliberate)

- **Brand logins or a brand dashboard.** Add `brand_members` plus a read-only
  RLS-bound role when a brand needs self-serve reporting. Don't hand a brand a
  session that can touch athlete rows.
- **AI brand preference.** Needs a server-side module that appends a *labelled*
  sponsored block *outside* the coaching instructions, plus a hard rule that
  brand context never changes training, recovery, injury, nutrition or medical
  advice. A brand must never be able to influence a training prescription.
- **Brand-funded challenge rewards.** `challenges.reward_credits` exists and is
  currently never granted. Wiring it up needs verified progress first —
  `update_challenge_progress(p_delta)` trusts a client-supplied number, so
  completion is self-certified today. That is fine for bragging rights and
  unusable as the basis for paying out a sponsor's money.
- **An admin UI** for brands/placements (`AdminRewards`/`AdminPricing` are the
  pattern to follow) — SQL is quicker until the first renewal.
