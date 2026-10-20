CREATE TABLE public.account_deletion_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_ref text NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  region text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.account_deletion_events TO service_role;

ALTER TABLE public.account_deletion_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view deletion events"
ON public.account_deletion_events FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_account_deletion_events_user_ref ON public.account_deletion_events (user_ref, created_at DESC);