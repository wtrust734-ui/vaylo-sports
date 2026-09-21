
CREATE TABLE public.outcome_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'performance',
  metric_unit text,
  start_value numeric DEFAULT 0,
  current_value numeric DEFAULT 0,
  target_value numeric,
  deadline date,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.process_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  outcome_goal_id uuid REFERENCES public.outcome_goals(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  weekly_target integer NOT NULL DEFAULT 3,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.daily_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  process_goal_id uuid REFERENCES public.process_goals(id) ON DELETE CASCADE,
  title text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.daily_action_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action_id uuid NOT NULL REFERENCES public.daily_actions(id) ON DELETE CASCADE,
  log_date date NOT NULL DEFAULT CURRENT_DATE,
  completed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (action_id, log_date)
);

CREATE TABLE public.accountability_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.accountability_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.accountability_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);

CREATE TABLE public.weekly_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  week_start date NOT NULL,
  reliability_score integer NOT NULL DEFAULT 0,
  completion_pct integer NOT NULL DEFAULT 0,
  ai_feedback text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);

-- Helper to avoid recursive RLS on accountability_members
CREATE OR REPLACE FUNCTION public.is_group_member(_group uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.accountability_members WHERE group_id = _group AND user_id = _user);
$$;

ALTER TABLE public.outcome_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.process_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_action_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accountability_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accountability_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own outcome goals" ON public.outcome_goals
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Partners view outcome goals" ON public.outcome_goals
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.friendships f
      WHERE (f.user_id = auth.uid() AND f.friend_id = outcome_goals.user_id)
         OR (f.friend_id = auth.uid() AND f.user_id = outcome_goals.user_id))
  );

CREATE POLICY "Users manage own process goals" ON public.process_goals
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own daily actions" ON public.daily_actions
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own action logs" ON public.daily_action_logs
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Partners view action logs" ON public.daily_action_logs
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.friendships f
      WHERE (f.user_id = auth.uid() AND f.friend_id = daily_action_logs.user_id)
         OR (f.friend_id = auth.uid() AND f.user_id = daily_action_logs.user_id))
  );

CREATE POLICY "Owners manage groups" ON public.accountability_groups
  FOR ALL TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Members view groups" ON public.accountability_groups
  FOR SELECT TO authenticated USING (public.is_group_member(id, auth.uid()));

CREATE POLICY "Members view membership" ON public.accountability_members
  FOR SELECT TO authenticated USING (
    user_id = auth.uid() OR public.is_group_member(group_id, auth.uid())
  );
CREATE POLICY "Owners or self add members" ON public.accountability_members
  FOR INSERT TO authenticated WITH CHECK (
    user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.accountability_groups g WHERE g.id = group_id AND g.owner_id = auth.uid()
    )
  );
CREATE POLICY "Self leave or owner removes" ON public.accountability_members
  FOR DELETE TO authenticated USING (
    user_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.accountability_groups g WHERE g.id = group_id AND g.owner_id = auth.uid()
    )
  );

CREATE POLICY "Users manage own reviews" ON public.weekly_reviews
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_process_goals_outcome ON public.process_goals(outcome_goal_id);
CREATE INDEX idx_daily_actions_process ON public.daily_actions(process_goal_id);
CREATE INDEX idx_action_logs_user_date ON public.daily_action_logs(user_id, log_date);

CREATE TRIGGER trg_outcome_goals_updated BEFORE UPDATE ON public.outcome_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_process_goals_updated BEFORE UPDATE ON public.process_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
