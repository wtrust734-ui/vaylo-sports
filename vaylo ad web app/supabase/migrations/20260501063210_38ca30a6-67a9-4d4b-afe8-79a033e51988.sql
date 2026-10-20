ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS sex text,
ADD COLUMN IF NOT EXISTS extended_profile jsonb DEFAULT '{}'::jsonb;