-- Performance metrics (raw test data: sprints, jumps, shots, reactions, etc.)
CREATE TABLE public.performance_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  metric_type TEXT NOT NULL, -- e.g. 'sprint_40m', 'vertical_jump', 'shooting_accuracy', 'reaction_time', 'beep_test', 'serve_consistency'
  value NUMERIC NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  sport TEXT,
  fatigue_level INTEGER, -- 1-10, captured at test time
  notes TEXT,
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.performance_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own metrics" ON public.performance_metrics FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_perf_metrics_user_date ON public.performance_metrics(user_id, log_date DESC);

-- VPR snapshots
CREATE TABLE public.vpr_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  sport TEXT NOT NULL,
  position TEXT,
  speed_index NUMERIC NOT NULL DEFAULT 0,
  power_index NUMERIC NOT NULL DEFAULT 0,
  endurance_capacity NUMERIC NOT NULL DEFAULT 0,
  repeatability NUMERIC NOT NULL DEFAULT 0,
  skill_consistency NUMERIC NOT NULL DEFAULT 0,
  reaction_efficiency NUMERIC NOT NULL DEFAULT 0,
  overall_vpr NUMERIC NOT NULL DEFAULT 0,
  archetype TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.vpr_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own vpr" ON public.vpr_snapshots FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_vpr_user_date ON public.vpr_snapshots(user_id, created_at DESC);

-- Daily training load
CREATE TABLE public.training_loads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  sprint_load NUMERIC NOT NULL DEFAULT 0,
  endurance_load NUMERIC NOT NULL DEFAULT 0,
  strength_load NUMERIC NOT NULL DEFAULT 0,
  skill_load NUMERIC NOT NULL DEFAULT 0,
  total_rpe NUMERIC NOT NULL DEFAULT 0, -- session RPE * minutes
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, log_date)
);
ALTER TABLE public.training_loads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own loads" ON public.training_loads FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_loads_user_date ON public.training_loads(user_id, log_date DESC);

-- Competition sessions
CREATE TABLE public.competition_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  event_id UUID,
  title TEXT NOT NULL,
  sport TEXT NOT NULL,
  competition_date DATE NOT NULL DEFAULT CURRENT_DATE,
  pre_readiness INTEGER, -- 0-100
  ns_freshness INTEGER, -- 0-100 nervous system
  tactical_plan TEXT,
  warmup_plan TEXT,
  focus_cues TEXT,
  execution_rating INTEGER, -- 0-100 post
  decision_quality INTEGER, -- 0-100 post
  fatigue_impact INTEGER, -- 0-100 post
  limiting_factor TEXT,
  improvement_priority TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | in_progress | completed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.competition_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own competitions" ON public.competition_sessions FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER comp_sessions_updated BEFORE UPDATE ON public.competition_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Tactical plans (opponent prep)
CREATE TABLE public.tactical_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  competition_id UUID,
  opponent_style TEXT,
  match_format TEXT,
  environment TEXT,
  competition_level TEXT,
  position TEXT,
  generated_priorities JSONB,
  training_adjustments TEXT,
  risk_notes TEXT,
  warmup_customization TEXT,
  psychological_cues TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tactical_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own tactical plans" ON public.tactical_plans FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Athlete position (one row per user)
CREATE TABLE public.athlete_position (
  user_id UUID NOT NULL PRIMARY KEY,
  primary_sport TEXT,
  position TEXT,
  secondary_sport TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.athlete_position ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own position" ON public.athlete_position FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER athlete_pos_updated BEFORE UPDATE ON public.athlete_position
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();