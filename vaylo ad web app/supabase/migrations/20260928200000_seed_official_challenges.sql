-- ============================================================================
-- SEED THE OFFICIAL CHALLENGES
-- ----------------------------------------------------------------------------
-- `public.challenges` has been empty since it was created, so Compete renders
-- a blank tab and a Play reviewer sees a feature with nothing in it. The client
-- already carries a suggested-challenge library (src/pages/Challenges.tsx) that
-- an athlete can create from — so the templates existed, the rows never did.
-- These are those templates, published as official starting content.
--
-- `creator_id` was NOT NULL, which is the reason nothing had ever been seeded:
-- there is no system user to own a challenge. Rather than fabricate a profile
-- row that would show up in member lists and own content a human never wrote,
-- NULL now means "published by Vaylo". The existing policies are all
-- `auth.uid() = creator_id`, and NULL never matches, so an official challenge
-- is immutable and undeletable by every athlete — the correct default for
-- content the whole app points at.
--
-- The end dates are deliberately far out. The list treats a challenge as Active
-- while `end_date` is in the future, so a near window would silently empty the
-- tab again. These are evergreen until then; shortening them is a product
-- decision about seasons, not a schema one.
-- ============================================================================

ALTER TABLE public.challenges ALTER COLUMN creator_id DROP NOT NULL;

COMMENT ON COLUMN public.challenges.creator_id IS
  'Athlete who created the challenge. NULL means published by Vaylo (is_official).';

-- Fixed ids so re-running this migration is a no-op rather than a duplicate set.
INSERT INTO public.challenges (
  id, creator_id, title, description, type, target_value, target_unit,
  start_date, end_date, scope, reward_credits, reward_points, icon,
  is_official, participant_count
) VALUES
  ('11111111-1111-4111-8111-111111111101', NULL,
   '30km week', 'Base-building block for your sport. Five runs, one week, no heroics.',
   'distance', 30, 'km', CURRENT_DATE, DATE '2030-12-31', 'weekly', 10, 150, '🏃', true, 0),
  ('11111111-1111-4111-8111-111111111102', NULL,
   '5 quality sessions', 'Frequency over volume. Five sessions beats five long ones.',
   'count', 5, 'sessions', CURRENT_DATE, DATE '2030-12-31', 'weekly', 10, 150, '🔥', true, 0),
  ('11111111-1111-4111-8111-111111111103', NULL,
   '150km ride week', 'Aerobic base for cyclists. Bank the hours while the season is quiet.',
   'distance', 150, 'km', CURRENT_DATE, DATE '2030-12-31', 'weekly', 10, 150, '🚴', true, 0),
  ('11111111-1111-4111-8111-111111111104', NULL,
   '6km pool volume', 'Consistent technique volume. Distance in the water, easy on the joints.',
   'distance', 6, 'km', CURRENT_DATE, DATE '2030-12-31', 'weekly', 10, 150, '🏊', true, 0),
  ('11111111-1111-4111-8111-111111111105', NULL,
   '4 skill sessions', 'Ball-work reps compound fast. Four touches sessions, any length.',
   'count', 4, 'sessions', CURRENT_DATE, DATE '2030-12-31', 'weekly', 10, 150, '⚽', true, 0),
  ('11111111-1111-4111-8111-111111111106', NULL,
   '500 shots week', 'Shooting volume tied to accuracy. Volume first, form follows.',
   'count', 500, 'shots', CURRENT_DATE, DATE '2030-12-31', 'weekly', 10, 150, '🏀', true, 0),
  ('11111111-1111-4111-8111-111111111107', NULL,
   '4 gym sessions', 'Strength baseline block. Three lifts and one conditioning day.',
   'count', 4, 'sessions', CURRENT_DATE, DATE '2030-12-31', 'weekly', 10, 150, '🏋️', true, 0),
  ('11111111-1111-4111-8111-111111111108', NULL,
   'Move every day', 'The streak-builder. One logged activity a day, seven days.',
   'count', 7, 'days', CURRENT_DATE, DATE '2030-12-31', 'weekly', 15, 200, '⚡', true, 0),
  ('11111111-1111-4111-8111-111111111109', NULL,
   '12 strength sessions', 'Matches your strength goal. A month of showing up to the barbell.',
   'count', 12, 'sessions', CURRENT_DATE, DATE '2030-12-31', 'monthly', 20, 250, '💪', true, 0),
  ('11111111-1111-4111-8111-11111111110a', NULL,
   '300 aerobic minutes', 'Five hours of aerobic work a month. The base everything sits on.',
   'duration', 300, 'minutes', CURRENT_DATE, DATE '2030-12-31', 'monthly', 20, 250, '❤️', true, 0),
  ('11111111-1111-4111-8111-11111111110b', NULL,
   '21 clean days', 'Log 21 days of hitting your nutrition target. One month.',
   'count', 21, 'days', CURRENT_DATE, DATE '2030-12-31', 'monthly', 20, 250, '🥗', true, 0),
  ('11111111-1111-4111-8111-11111111110c', NULL,
   '20 recovery check-ins', 'Track readiness daily. Two weeks and a half of honest check-ins.',
   'count', 20, 'check-ins', CURRENT_DATE, DATE '2030-12-31', 'monthly', 20, 250, '🧘', true, 0)
ON CONFLICT (id) DO NOTHING;
