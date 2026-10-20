-- ============================================================================
-- EVENT TROPHIES — time-ladder trophies for timed distance events
-- ----------------------------------------------------------------------------
-- The request: "if you log a pb, a card should show with your PB and there
-- should be a trophy for different times for each event — and the trophy
-- shouldn't show up if you don't do that sport."
--
-- Implementation:
--   * `event_trophy_events` — one row per timed event (Running 1K..Marathon,
--     Cycling 10K/40K, Swimming 100m/1K), each with Bronze/Silver/Gold
--     thresholds in `tiers`.
--   * A reward_definitions badge per tier (ids mirror the client ladder in
--     src/lib/eventTrophies.ts: trophy_<event_id>_<tier>), category
--     'event_trophy', earn-only (no coin_price — purchase_cosmetic refuses
--     badges by design), and equippable in the existing badge slot.
--   * `claim_event_trophies(p_log_id)` — the log-save flow calls this once per
--     log with distance + time. It matches the event by sport and distance
--     (±2%, the same tolerance as the client), computes every tier the time
--     meets OR BEATS the athlete's previous best (a Gold time has passed
--     Bronze and Silver too), and grants each not-yet-owned trophy. Idempotent
--     via the UNIQUE(user_id, reward_id) on user_rewards.
--   * Sport gating is display-side (from the athlete's real logged sports) —
--     a trophy cannot be *earned* for a sport the athlete has not logged,
--     because the grant itself only fires on a log of that sport.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.event_trophy_events (
  id TEXT PRIMARY KEY,
  sport TEXT NOT NULL,
  distance_km NUMERIC NOT NULL CHECK (distance_km > 0),
  label TEXT NOT NULL,
  icon TEXT,
  tiers JSONB NOT NULL CHECK (jsonb_typeof(tiers) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.event_trophy_events TO anon, authenticated;
GRANT ALL ON public.event_trophy_events TO service_role;
ALTER TABLE public.event_trophy_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_trophy_events_read" ON public.event_trophy_events FOR SELECT USING (true);

-- ---------------------------------------------------------------------------
-- The ladder. Thresholds mirror src/lib/eventTrophies.ts exactly — the client
-- previews with the same numbers the server grants with.
-- ---------------------------------------------------------------------------
INSERT INTO public.event_trophy_events (id, sport, distance_km, label, icon, tiers) VALUES
  ('run_1k',    'Running',  1,       'Running · 1K',        'Zap',
   '[{"tier":"bronze","time_seconds":360},{"tier":"silver","time_seconds":300},{"tier":"gold","time_seconds":230}]'),
  ('run_5k',    'Running',  5,       'Running · 5K',        'Flag',
   '[{"tier":"bronze","time_seconds":1800},{"tier":"silver","time_seconds":1440},{"tier":"gold","time_seconds":1100}]'),
  ('run_10k',   'Running',  10,      'Running · 10K',       'Flag',
   '[{"tier":"bronze","time_seconds":3900},{"tier":"silver","time_seconds":3000},{"tier":"gold","time_seconds":2300}]'),
  ('run_half',  'Running',  21.0975, 'Running · Half',      'Timer',
   '[{"tier":"bronze","time_seconds":9000},{"tier":"silver","time_seconds":7200},{"tier":"gold","time_seconds":5760}]'),
  ('run_full',  'Running',  42.195,  'Running · Marathon',  'Trophy',
   '[{"tier":"bronze","time_seconds":18000},{"tier":"silver","time_seconds":15000},{"tier":"gold","time_seconds":12200}]'),
  ('ride_10k',  'Cycling',  10,      'Cycling · 10K',       'Bike',
   '[{"tier":"bronze","time_seconds":1320},{"tier":"silver","time_seconds":1020},{"tier":"gold","time_seconds":780}]'),
  ('ride_40k',  'Cycling',  40,      'Cycling · 40K',       'Bike',
   '[{"tier":"bronze","time_seconds":4680},{"tier":"silver","time_seconds":3900},{"tier":"gold","time_seconds":3180}]'),
  ('swim_100m', 'Swimming', 0.1,     'Swimming · 100m',     'Waves',
   '[{"tier":"bronze","time_seconds":180},{"tier":"silver","time_seconds":130},{"tier":"gold","time_seconds":85}]'),
  ('swim_1k',   'Swimming', 1,       'Swimming · 1K',       'Waves',
   '[{"tier":"bronze","time_seconds":1500},{"tier":"silver","time_seconds":1200},{"tier":"gold","time_seconds":900}]')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Badge definitions: one per (event, tier). payload carries what renderers
-- need (event label, sport, distance, tier, best threshold).
-- ---------------------------------------------------------------------------
INSERT INTO public.reward_definitions (id, name, description, type, category, rarity, payload, icon, coin_cost, active)
SELECT
  'trophy_' || e.id || '_' || (t->>'tier'),
  e.label || ' — ' ||
    CASE t->>'tier' WHEN 'gold' THEN 'Gold' WHEN 'silver' THEN 'Silver' ELSE 'Bronze' END,
  e.label || ' in ' || ((t->>'time_seconds')::int / 60)::text || ':' ||
    lpad(((t->>'time_seconds')::int % 60)::text, 2, '0') || ' or faster.',
  'badge', 'event_trophy',
  CASE t->>'tier' WHEN 'gold' THEN 'epic' WHEN 'silver' THEN 'rare' ELSE 'common' END,
  jsonb_build_object(
    'event_id', e.id, 'event_label', e.label, 'sport', e.sport,
    'distance_km', e.distance_km, 'tier', t->>'tier',
    'time_seconds', (t->>'time_seconds')::int
  ),
  lower(t->>'tier'),
  NULL,  -- earn-only: purchase_cosmetic refuses badges; this stays a reward
  true
FROM public.event_trophy_events e,
     jsonb_array_elements(e.tiers) t
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- claim_event_trophies(log_id) — called once per logged session.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_event_trophies(p_log_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_dist numeric;
  v_sport text;
  v_time integer;
  v_event record;
  v_tier record;
  v_grant_row text;
  v_granted jsonb := '[]'::jsonb;
  v_reward_id text;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_log_id IS NULL THEN RAISE EXCEPTION 'Log id required'; END IF;

  -- The log must belong to the caller, and only timed distance events play.
  SELECT distance_km, sport, time_seconds INTO v_dist, v_sport, v_time
  FROM public.performance_logs
  WHERE id = p_log_id AND user_id = v_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown log'; END IF;
  IF v_dist IS NULL OR v_dist <= 0 OR v_time IS NULL OR v_time <= 0 OR v_sport IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'event', NULL, 'trophies', v_granted);
  END IF;

  -- Event match: same sport (case-insensitive), distance within 2% — the same
  -- rule the client previews with. Nearest event inside the tolerance wins.
  SELECT * INTO v_event
  FROM public.event_trophy_events e
  WHERE lower(e.sport) = lower(btrim(v_sport))
    AND e.distance_km BETWEEN v_dist * 0.98 AND v_dist * 1.02
  ORDER BY abs(e.distance_km - v_dist)
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'event', NULL, 'trophies', v_granted);
  END IF;

  -- A logged session earns every tier its time meets — the time is what the
  -- trophy honours, PB or not. (A 22:00 5K on an ordinary Tuesday still
  -- deserves the Bronze it crossed.)
  FOR v_tier IN
    SELECT j->>'tier' AS tier, (j->>'time_seconds')::int AS threshold
    FROM jsonb_array_elements(v_event.tiers) j
    WHERE (j->>'time_seconds')::int >= v_time
    ORDER BY (j->>'time_seconds')::int DESC
  LOOP
    v_reward_id := 'trophy_' || v_event.id || '_' || v_tier.tier;

    -- Idempotent grant: UNIQUE(user_id, reward_id) + ON CONFLICT. RETURNING
    -- reports only the row this call actually inserted, so concurrent claims
    -- of the same log cannot double-report (or double-report across doubles).
    INSERT INTO public.user_rewards (user_id, reward_id, type, category, rarity, source)
    SELECT v_user, d.id, d.type, d.category, d.rarity, 'event_trophy'
    FROM public.reward_definitions d
    WHERE d.id = v_reward_id AND d.active
    ON CONFLICT (user_id, reward_id) DO NOTHING
    RETURNING reward_id INTO v_grant_row;

    IF v_grant_row IS NOT NULL THEN
      v_granted := v_granted || jsonb_build_array(jsonb_build_object(
        'reward_id', v_reward_id,
        'tier', v_tier.tier,
        'name', (SELECT name FROM public.reward_definitions WHERE id = v_reward_id)
      ));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'event', jsonb_build_object(
      'id', v_event.id, 'label', v_event.label, 'sport', v_event.sport
    ),
    'trophies', v_granted
  );
END; $$;

REVOKE ALL ON FUNCTION public.claim_event_trophies(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_event_trophies(uuid) TO authenticated;

COMMENT ON FUNCTION public.claim_event_trophies(uuid) IS
  'Grants the event-trophy badges a logged timed-distance session earns (event match by sport + distance ±2%, all tiers the time meets). Idempotent per user+reward.';
