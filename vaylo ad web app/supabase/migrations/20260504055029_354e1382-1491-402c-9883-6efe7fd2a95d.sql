ALTER TABLE public.user_settings 
ADD COLUMN IF NOT EXISTS ar_persona TEXT NOT NULL DEFAULT 'coach_pro',
ADD COLUMN IF NOT EXISTS ar_metrics JSONB NOT NULL DEFAULT '["pace","heart_rate","power","cadence"]'::jsonb,
ADD COLUMN IF NOT EXISTS ar_theme TEXT NOT NULL DEFAULT 'electric',
ADD COLUMN IF NOT EXISTS ar_position TEXT NOT NULL DEFAULT 'top',
ADD COLUMN IF NOT EXISTS ar_voice_enabled BOOLEAN NOT NULL DEFAULT true;