
-- Add new columns to recovery_logs
ALTER TABLE public.recovery_logs
  ADD COLUMN IF NOT EXISTS hrv integer,
  ADD COLUMN IF NOT EXISTS rhr integer,
  ADD COLUMN IF NOT EXISTS stress integer,
  ADD COLUMN IF NOT EXISTS energy integer,
  ADD COLUMN IF NOT EXISTS rest_hours numeric,
  ADD COLUMN IF NOT EXISTS adjusted_session jsonb;

-- Create hrv_baselines table
CREATE TABLE public.hrv_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  hrv_7day_avg numeric,
  rhr_7day_avg numeric,
  trend text DEFAULT 'stable',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

ALTER TABLE public.hrv_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own baselines"
  ON public.hrv_baselines
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
