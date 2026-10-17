-- ============================================================================
-- SEASONAL COLLECTION SEED — Winter 2026/27
-- ----------------------------------------------------------------------------
-- Research finding (§14-C): the seasonal section of the catalogue had
-- hardcoded one-off dates and no fresh seasonal content since the July seed.
-- This seeds a real winter collection with sensible prices BY RARITY
-- (rare 400 · epic 900, matching 20260921090500's ladder) and declares the
-- return rule in each description — scarcity without a promise of exclusivity,
-- exactly the wording Fortnite itself uses ("may return at least 18 months
-- later"). No countdown UI, no fake exclusivity.
-- ============================================================================

INSERT INTO public.reward_definitions
  (id, name, description, type, category, rarity, payload, icon, season, available_from, available_to, coin_cost)
VALUES
  ('border_frost_line',
   'Frost Line Border',
   'Cool ice-blue profile ring. Winter 2026/27 collection — items may return in future winter seasons.',
   'border', 'border', 'rare',
   '{"color":"#7dd3fc"}', 'circle', 'winter_2026',
   '2026-11-15T00:00:00Z', '2027-01-15T23:59:59Z', 400),
  ('bg_alpine_night',
   'Alpine Night Backdrop',
   'Deep alpine night behind your profile card. Winter 2026/27 collection — items may return in future winter seasons.',
   'background', 'background', 'rare',
   '{"color":"#1e2f56"}', 'mountain', 'winter_2026',
   '2026-11-15T00:00:00Z', '2027-01-15T23:59:59Z', 400),
  ('border_ember_line',
   'Ember Line Border',
   'Warm ember ring for the cold months. Winter 2026/27 collection — items may return in future winter seasons.',
   'border', 'border', 'epic',
   '{"color":"#fb923c"}', 'circle', 'winter_2026',
   '2026-11-15T00:00:00Z', '2027-01-15T23:59:59Z', 900),
  ('bg_stadium_finals',
   'Stadium Finals Backdrop',
   'The under-lights finals stadium. Winter 2026/27 collection — items may return in future winter seasons.',
   'background', 'background', 'epic',
   '{"color":"#2d3a8c"}', 'image', 'winter_2026',
   '2026-11-15T00:00:00Z', '2027-01-15T23:59:59Z', 900)
ON CONFLICT (id) DO NOTHING;
