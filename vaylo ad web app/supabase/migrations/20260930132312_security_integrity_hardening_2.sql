-- Follow-up to security_integrity_hardening: replacing the (user_id,
-- provider_reference) unique with a global provider_reference unique removed the
-- only user-leading index on user_purchases, which the FK advisor then flagged
-- (and which every per-user purchase lookup needs).
CREATE INDEX IF NOT EXISTS idx_user_purchases_user_id
  ON public.user_purchases (user_id);
