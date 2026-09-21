
-- =========================================================
-- Big Reward Chest System
-- =========================================================

-- 1) Reward catalog
CREATE TABLE public.reward_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('credits','cosmetic','title','badge','border','background','name_color','effect','animation','consumable','seasonal')),
  category TEXT NOT NULL,
  rarity TEXT NOT NULL CHECK (rarity IN ('common','rare','epic','legendary','mythic')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  icon TEXT,
  season TEXT,
  available_from TIMESTAMPTZ,
  available_to TIMESTAMPTZ,
  weight_override INTEGER,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.reward_definitions TO anon, authenticated;
GRANT ALL ON public.reward_definitions TO service_role;
ALTER TABLE public.reward_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reward_definitions_read" ON public.reward_definitions FOR SELECT USING (true);
CREATE POLICY "reward_definitions_admin_write" ON public.reward_definitions FOR ALL
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2) User inventory (permanent unlocks)
CREATE TABLE public.user_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reward_id TEXT NOT NULL REFERENCES public.reward_definitions(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  rarity TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'chest',
  equipped BOOLEAN NOT NULL DEFAULT false,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, reward_id)
);
GRANT SELECT ON public.user_rewards TO authenticated;
GRANT ALL ON public.user_rewards TO service_role;
ALTER TABLE public.user_rewards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_rewards_owner_read" ON public.user_rewards FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "user_rewards_owner_equip" ON public.user_rewards FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 3) Consumables
CREATE TABLE public.user_consumables (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reward_id TEXT NOT NULL REFERENCES public.reward_definitions(id),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, reward_id)
);
GRANT SELECT ON public.user_consumables TO authenticated;
GRANT ALL ON public.user_consumables TO service_role;
ALTER TABLE public.user_consumables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_consumables_owner_read" ON public.user_consumables FOR SELECT USING (auth.uid() = user_id);

-- 4) Equipped profile cosmetics (single row per user)
CREATE TABLE public.user_profile_cosmetics (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  title_id TEXT REFERENCES public.reward_definitions(id) ON DELETE SET NULL,
  border_id TEXT REFERENCES public.reward_definitions(id) ON DELETE SET NULL,
  background_id TEXT REFERENCES public.reward_definitions(id) ON DELETE SET NULL,
  name_color_id TEXT REFERENCES public.reward_definitions(id) ON DELETE SET NULL,
  badge_id TEXT REFERENCES public.reward_definitions(id) ON DELETE SET NULL,
  theme_id TEXT REFERENCES public.reward_definitions(id) ON DELETE SET NULL,
  effect_id TEXT REFERENCES public.reward_definitions(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.user_profile_cosmetics TO authenticated;
GRANT ALL ON public.user_profile_cosmetics TO service_role;
ALTER TABLE public.user_profile_cosmetics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profile_cosmetics_owner_read" ON public.user_profile_cosmetics FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "profile_cosmetics_owner_upsert" ON public.user_profile_cosmetics FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "profile_cosmetics_owner_update" ON public.user_profile_cosmetics FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- Everyone can see other users' equipped cosmetics for public profile rendering
CREATE POLICY "profile_cosmetics_public_read" ON public.user_profile_cosmetics FOR SELECT USING (true);

-- 5) Chest claims (one per weekly cycle)
CREATE TABLE public.chest_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cycle_number INTEGER NOT NULL,
  reward_id TEXT NOT NULL REFERENCES public.reward_definitions(id),
  reward_type TEXT NOT NULL,
  rarity TEXT NOT NULL,
  was_duplicate BOOLEAN NOT NULL DEFAULT false,
  converted_credits INTEGER NOT NULL DEFAULT 0,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, cycle_number)
);
GRANT SELECT ON public.chest_claims TO authenticated;
GRANT ALL ON public.chest_claims TO service_role;
ALTER TABLE public.chest_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chest_claims_owner_read" ON public.chest_claims FOR SELECT USING (auth.uid() = user_id);

-- 6) Global reward config (single row)
CREATE TABLE public.reward_config (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  probabilities JSONB NOT NULL DEFAULT '{"common":55,"rare":28,"epic":12,"legendary":4,"mythic":1}'::jsonb,
  duplicate_conversion JSONB NOT NULL DEFAULT '{"common":1,"rare":2,"epic":4,"legendary":8,"mythic":15}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.reward_config TO anon, authenticated;
GRANT ALL ON public.reward_config TO service_role;
ALTER TABLE public.reward_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reward_config_read" ON public.reward_config FOR SELECT USING (true);
CREATE POLICY "reward_config_admin_write" ON public.reward_config FOR ALL
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
INSERT INTO public.reward_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- update_updated_at triggers
CREATE TRIGGER trg_reward_def_updated BEFORE UPDATE ON public.reward_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_reward_cfg_updated BEFORE UPDATE ON public.reward_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_profile_cosmetics_updated BEFORE UPDATE ON public.user_profile_cosmetics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- Seed reward catalog
-- =========================================================
INSERT INTO public.reward_definitions (id, name, description, type, category, rarity, payload, icon) VALUES
-- Credits (consumable-style but resolved instantly)
('credits_2',  '2 Credits',  'Two credits added to your balance.',   'credits', 'credits', 'common', '{"amount":2}',  'coins'),
('credits_5',  '5 Credits',  'Five credits added to your balance.',  'credits', 'credits', 'rare',   '{"amount":5}',  'coins'),
('credits_10', '10 Credits', 'Ten credits added to your balance.',   'credits', 'credits', 'epic',   '{"amount":10}', 'coins'),

-- Avatar cosmetics (small starter set — expand from admin)
('hair_flow_gold',   'Golden Flow Hair',     'Long flowing gold hair.',      'cosmetic', 'hair',        'legendary', '{}', 'user'),
('hair_buzz_black',  'Buzz Cut',             'Clean buzz cut.',              'cosmetic', 'hair',        'common',    '{}', 'user'),
('hat_snapback',     'Vaylo Snapback',       'Signature snapback.',          'cosmetic', 'hats',        'rare',      '{}', 'hard-hat'),
('helmet_visor',     'Visor Helmet',         'Sleek competition helmet.',    'cosmetic', 'helmets',     'epic',      '{}', 'shield'),
('glasses_shades',   'Blackout Shades',      'Post-game shades.',            'cosmetic', 'glasses',     'rare',      '{}', 'glasses'),
('jersey_home',      'Home Jersey',          'Classic home kit.',            'cosmetic', 'jerseys',     'common',    '{}', 'shirt'),
('jersey_gold',      'Champions Jersey',     'Gold champion jersey.',        'cosmetic', 'jerseys',     'legendary', '{}', 'shirt'),
('hoodie_black',     'Blackout Hoodie',      'Warm-up hoodie.',              'cosmetic', 'hoodies',     'common',    '{}', 'shirt'),
('shorts_perf',      'Performance Shorts',   'Lightweight training shorts.', 'cosmetic', 'shorts',      'common',    '{}', 'shirt'),
('boots_carbon',     'Carbon Football Boots','Carbon-plate boots.',          'cosmetic', 'football_boots','epic',    '{}', 'footprints'),
('runners_air',      'Airflow Runners',      'Ultralight runners.',          'cosmetic', 'running_shoes','rare',     '{}', 'footprints'),
('gloves_grip',      'Grip Gloves',          'Signature grip gloves.',       'cosmetic', 'gloves',      'rare',      '{}', 'hand'),
('watch_gps',        'GPS Watch',            'Wrist-mounted GPS.',           'cosmetic', 'watches',     'epic',      '{}', 'watch'),
('bottle_hydro',     'Hydro Bottle',         'Insulated water bottle.',      'cosmetic', 'water_bottles','common',   '{}', 'droplet'),
('pose_flex',        'Flex Pose',            'Classic flex victory pose.',   'cosmetic', 'victory_poses','rare',     '{}', 'sparkles'),
('anim_run_fast',    'Sprint Run Cycle',     'Faster running animation.',    'animation','running_animations','epic', '{}', 'zap'),
('anim_celeb_gold',  'Gold Celebration',     'Legendary celebration.',       'animation','celebration_animations','legendary','{}','sparkles'),
('fx_gold_dust',     'Gold Dust Trail',      'Gold particle trail.',         'effect',   'particle_effects','legendary','{}','sparkles'),
('aura_champion',    'Champion Aura',        'Radiant golden aura.',         'effect',   'auras',       'mythic',    '{}', 'sun'),

-- Titles
('title_champion',   'Champion',        'For those who win when it counts.','title','title','epic',      '{"label":"Champion"}',      'crown'),
('title_legend',     'Legend',          'Immortalised.',                    'title','title','legendary', '{"label":"Legend"}',        'crown'),
('title_elite',      'Elite',           'Top of the class.',                'title','title','epic',      '{"label":"Elite"}',         'crown'),
('title_founder',    'Founder',         'Here from day one.',               'title','title','mythic',    '{"label":"Founder"}',       'crown'),
('title_grinder',    'Daily Grinder',   'Never misses a day.',              'title','title','rare',     '{"label":"Daily Grinder"}', 'flame'),
('title_winner',     'Winner',          'Wins matter.',                     'title','title','common',   '{"label":"Winner"}',        'trophy'),
('title_captain',    'Captain',         'Leads by example.',                'title','title','rare',     '{"label":"Captain"}',       'star'),
('title_goat',       'GOAT',            'Greatest of all time.',            'title','title','mythic',   '{"label":"GOAT"}',          'crown'),
('title_lucky',      'Lucky',           'Some just have it.',               'title','title','rare',     '{"label":"Lucky"}',         'clover'),
('title_underdog',   'Underdog',        'Everyone loves an upset.',         'title','title','common',   '{"label":"Underdog"}',      'dog'),
('title_dedicated',  'Dedicated',       'Reps in, rewards out.',            'title','title','common',   '{"label":"Dedicated"}',     'target'),
('title_playmaker',  'Playmaker',       'Creates chances.',                 'title','title','epic',     '{"label":"Playmaker"}',     'zap'),

-- Badges
('badge_streak_7',   '7 Day Streak',    'One full week.',                   'badge','badge','common',   '{}', 'flame'),
('badge_collector',  'Collector',       'Growing collection.',              'badge','badge','rare',     '{}', 'package'),
('badge_lucky_pull', 'Lucky Pull',      'Pulled a legendary.',              'badge','badge','epic',     '{}', 'clover'),
('badge_veteran',    'Veteran',         'Long-standing member.',            'badge','badge','epic',     '{}', 'medal'),
('badge_early',      'Early Supporter', 'Supported us early.',              'badge','badge','legendary','{}', 'star'),
('badge_season_1',   'Season One',      'Season one exclusive.',            'badge','badge','legendary','{}', 'star'),
('badge_sports_fan', 'Sports Fan',      'Loves the game.',                  'badge','badge','common',   '{}', 'heart'),
('badge_avatar',     'Avatar Collector','25 cosmetics owned.',              'badge','badge','rare',     '{}', 'user'),

-- Profile borders
('border_silver',    'Silver Border',        'Clean silver border.',        'border','border','rare',      '{"color":"#C0C0C0"}',            'circle'),
('border_gold',      'Gold Border',          'Rich gold border.',           'border','border','epic',      '{"color":"#FFD700"}',            'circle'),
('border_neon',      'Neon Pulse Border',    'Animated neon pulse.',        'border','animated_border','legendary','{"animated":true,"color":"#00E5FF"}','circle'),
('border_rainbow',   'Rainbow Prism Border', 'Animated rainbow gradient.',  'border','animated_border','mythic',   '{"animated":true}',              'circle'),

-- Profile backgrounds
('bg_arena',         'Arena Background',     'Stadium at night.',           'background','background','rare','{}', 'image'),
('bg_summit',        'Summit Background',    'Mountain summit at dawn.',    'background','background','epic','{}', 'mountain'),
('bg_galaxy',        'Galaxy Background',    'Animated galactic scene.',    'background','animated_background','legendary','{"animated":true}','sparkles'),

-- Name colors
('name_blue',        'Electric Blue Name',   'Vaylo signature blue.',       'name_color','name_color','rare','{"color":"#00E5FF"}','type'),
('name_gold',        'Gold Name',            'Legendary gold text.',        'name_color','name_color','legendary','{"color":"#FFD700"}','type'),
('name_rainbow',     'Rainbow Name',         'Animated rainbow text.',      'name_color','animated_name_color','mythic','{"animated":true}','type'),

-- Effects
('fx_click_spark',   'Click Spark Effect',   'Sparks on tap.',              'effect','profile_effect','rare','{}', 'sparkle'),
('fx_hover_glow',    'Hover Glow',           'Glow on hover.',              'effect','profile_effect','epic','{}', 'sparkles'),

-- Consumables
('consumable_freeze',    'Streak Freeze',        'Protects your streak for one day.', 'consumable','consumable','rare','{"kind":"streak_freeze"}','shield'),
('consumable_trial_3d',  'Premium Trial 3 Days', '3 days of premium access.',         'consumable','consumable','epic','{"kind":"premium_trial","days":3}','crown'),
('consumable_disc_20',   'Premium Discount 20%', '20% off premium.',                  'consumable','consumable','rare','{"kind":"premium_discount","pct":20}','tag'),
('consumable_disc_50',   'Premium Discount 50%', '50% off premium.',                  'consumable','consumable','legendary','{"kind":"premium_discount","pct":50}','tag'),

-- Seasonal
('seasonal_xmas_hat',    'Santa Hat',            'Festive santa hat.',                'seasonal','seasonal','epic','{"season":"christmas"}','gift'),
('seasonal_hween_mask',  'Halloween Mask',       'Spooky mask.',                      'seasonal','seasonal','epic','{"season":"halloween"}','ghost'),
('seasonal_summer_shades','Summer Shades',       'Beach shades.',                     'seasonal','seasonal','rare','{"season":"summer"}','sun'),
('seasonal_winter_scarf','Winter Scarf',         'Cozy winter scarf.',                'seasonal','seasonal','rare','{"season":"winter"}','snowflake'),
('seasonal_olympics_med','Olympic Medallion',    'Rare olympic medallion.',           'seasonal','seasonal','legendary','{"season":"olympics"}','medal'),
('seasonal_wcup_jersey', 'World Cup Jersey',     'Limited world-cup jersey.',         'seasonal','seasonal','legendary','{"season":"world_cup"}','shirt');

-- Tag seasonal availability windows
UPDATE public.reward_definitions SET season='christmas', available_from='2026-12-01', available_to='2027-01-05' WHERE id='seasonal_xmas_hat';
UPDATE public.reward_definitions SET season='halloween', available_from='2026-10-15', available_to='2026-11-02' WHERE id='seasonal_hween_mask';
UPDATE public.reward_definitions SET season='summer',    available_from='2026-06-01', available_to='2026-09-01' WHERE id='seasonal_summer_shades';
UPDATE public.reward_definitions SET season='winter',    available_from='2026-12-01', available_to='2027-03-01' WHERE id='seasonal_winter_scarf';

-- =========================================================
-- open_chest_pick: RPC returning candidate reward set (used by edge fn)
-- (client cannot call directly for reward selection — enforced by function
--  reading rows; the edge function performs the weighted random & write).
-- =========================================================
