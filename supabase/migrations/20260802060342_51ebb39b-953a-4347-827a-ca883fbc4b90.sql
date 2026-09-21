CREATE TABLE public.video_form_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sport_type text NOT NULL DEFAULT 'general',
  video_name text,
  model_used text,
  overall_score integer,
  result jsonb NOT NULL,
  saved boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_video_form_analyses_user_created ON public.video_form_analyses (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.video_form_analyses TO authenticated;
GRANT ALL ON public.video_form_analyses TO service_role;

ALTER TABLE public.video_form_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own video analyses" ON public.video_form_analyses
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);