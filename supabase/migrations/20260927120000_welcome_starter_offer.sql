-- ============================================================================
-- Welcome starter offer — one discounted Welcome Bundle per new account.
-- ----------------------------------------------------------------------------
-- process-purchase already treats every `offer_<slug>` product id as a
-- one-time-per-account purchase (409 on redemption), so the ONLY thing needed
-- server-side is this row: the price, the grant bonus and the visibility
-- window. Idempotent — safe to re-run.
--
-- Display copy on the client derives the credit total from the linked pack
-- (pack_50 = 50 + 10) plus bonus_flat (25) = 85 credits for $3.99.
--
-- Also retires the legacy June-2026 'starter_pack' seed row: it expired by its
-- own ends_at but stayed active=true, so the Market kept rendering it.
-- ============================================================================

UPDATE public.special_offers
SET active = false
WHERE slug = 'starter_pack'
  AND active = true
  AND ends_at IS NOT NULL
  AND ends_at < now();

INSERT INTO public.special_offers
  (slug, title, description, offer_type, pack_id, bonus_flat, price_cents,
   region, starts_at, ends_at, target_audience, active)
VALUES
  ('welcome-starter',
   'Welcome Bundle',
   '85 credits to spend on plans, analysis and coaching — new-athlete price, one per account.',
   'starter',
   'pack_50',
   25,
   399,
   'GLOBAL',
   now(),
   NULL, -- no row deadline: the 72h account-age window is enforced in code, so the row stays valid
   'new',
   true)
ON CONFLICT (slug) DO UPDATE
SET title          = EXCLUDED.title,
    description    = EXCLUDED.description,
    offer_type     = EXCLUDED.offer_type,
    pack_id        = EXCLUDED.pack_id,
    bonus_flat     = EXCLUDED.bonus_flat,
    price_cents    = EXCLUDED.price_cents,
    region         = EXCLUDED.region,
    target_audience= EXCLUDED.target_audience,
    active         = EXCLUDED.active;
