-- Store-billing readiness.
--
-- An in-app purchase arrives with a store transaction id, and both Apple and
-- Google retry deliveries (and clients retry timeouts). Without a database-level
-- guarantee, a retried purchase would grant credits or coins twice.
--
-- `provider_reference` is that guarantee: one grant per store transaction per
-- athlete. `platform` records where a purchase came from, for reporting.

ALTER TABLE public.user_purchases ADD COLUMN IF NOT EXISTS provider_reference text;
ALTER TABLE public.user_purchases ADD COLUMN IF NOT EXISTS platform text;

COMMENT ON COLUMN public.user_purchases.provider_reference IS
  'Store transaction id / purchase token for IAP. Unique per user so retries cannot double-grant.';
COMMENT ON COLUMN public.user_purchases.platform IS
  'Where the purchase happened: web | ios | android.';

-- Partial index: web purchases have no reference (NULL) and are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS user_purchases_provider_reference_idx
  ON public.user_purchases (user_id, provider_reference)
  WHERE provider_reference IS NOT NULL;
