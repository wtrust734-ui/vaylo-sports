-- ============================================================================
-- sponsor_enquiries — the brand-side inbox behind the public Vaylo Sports site
-- ----------------------------------------------------------------------------
-- Why this exists.
--
-- Vaylo already has a sponsorship system: public.brands, public.brand_placements
-- and public.brand_metrics, plus the server-enforced 18+ gate described in
-- SPONSORSHIP.md. What it did not have was a way for a brand to *reach* it. The
-- only route was somebody emailing the operator by hand, which means the shape
-- of the deal — which placements, which sports, which regions, whether they want
-- a challenge or an achievement — arrived as prose and was re-typed.
--
-- So /sponsors/ now asks that shape as a short questionnaire and posts here
-- through the sponsor-enquiry edge function, which validates, rate-limits,
-- emails the operator and writes the row.
--
-- Design notes that matter:
--
--   * No public read access, at all. Same reasoning as support_requests and
--     waitlist_signups: these rows hold a named company's contact details and
--     the terms of a negotiation. A table that anyone can select is a leak of
--     who the operator is talking to and on what terms.
--
--   * This is an ENQUIRY, not a contract, and the schema keeps that honest.
--     Nothing here creates a brand, a placement or a discount. A row landing in
--     this table changes nothing about what the app serves. Turning one into a
--     live deal is still the deliberate manual step in SPONSORSHIP.md, because
--     a brand only appears to athletes after somebody has read the disclosure
--     obligations and set `status = 'active'` on purpose.
--
--   * `interests` is jsonb, not twenty boolean columns. The questionnaire is
--     expected to change as the product does, and a new question should not need
--     a migration. It is constrained to an object (never an array or a scalar,
--     which are the shapes a malformed client sends) so a query can always
--     treat a key as a key.
--
--   * `terms_version` and `terms_accepted_at` are NOT NULL. The enquiry form
--     requires an explicit acceptance of the brand enquiry terms, and the
--     version string is recorded with it — the same rule the app applies to
--     account terms, so acceptance is a fact with a date rather than an
--     inference from the fact that somebody submitted a form.
--
--   * `ip_hash` is salted per deployment and used for rate limiting and abuse
--     investigation only — never as an identifier, never for analytics. This
--     project has no analytics, deliberately.
-- ============================================================================

create table if not exists public.sponsor_enquiries (
  id            uuid        primary key default gen_random_uuid(),

  -- Short, quotable, random. Shown to the sender and used to find the row
  -- without exposing a row count that tells a competitor how busy we are.
  reference     text        not null unique,

  -- The company. Required: an enquiry that does not say who it is from is not
  -- an enquiry.
  brand_name    text        not null,

  website       text,
  contact_name  text,

  -- The one way we can reply. Required for the same reason as everywhere else.
  contact_email text        not null,

  -- The questionnaire answers, keyed by question. Shape is the contract the
  -- edge function re-derives; see sponsor-enquiry/index.ts for the closed key
  -- set. A key that is absent means "not asked", which is different from "no".
  interests     jsonb       not null default '{}'::jsonb,

  -- Which sports and regions the deal should target. Empty means "everyone",
  -- matching how brand_placements reads the same two columns — so what is
  -- collected here maps onto what can actually be delivered, rather than onto a
  -- separate vocabulary that would need translating later.
  sports        text[]      not null default '{}'::text[],
  regions       text[]      not null default '{}'::text[],

  -- Everything the questionnaire could not anticipate, in the brand's words.
  goals         text,

  -- Proof of acceptance. The version is the published document's version, not a
  -- timestamp, so a later change to the terms can be told apart from these
  -- answers. Both are set by the edge function from what the form sent, and the
  -- form cannot submit without them (checked again in the function).
  terms_version     text        not null,
  terms_accepted_at timestamptz not null default now(),

  -- Abuse investigation only. Not an identifier, not reused, clearable.
  ip_hash       text,
  user_agent    text,

  -- Whether the operator's inbox actually got the notification. A row that
  -- nobody was told about is a lead that sits unread, so this is recorded
  -- rather than assumed.
  email_message_sent boolean not null default false,
  email_sent_at      timestamptz,

  -- Where this enquiry has got to. 'new' means unread; 'active' means a brand
  -- row and placement were created by hand, which is the only thing that makes
  -- anything appear to an athlete.
  status        text        not null default 'new',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint sponsor_enquiries_status_check
    check (status in ('new', 'reviewing', 'contacted', 'declined', 'active')),

  -- Structural limits. Generous for a real enquiry, impossible for a script.
  constraint sponsor_enquiries_brand_name_len_check
    check (char_length(brand_name) between 1 and 160),
  constraint sponsor_enquiries_email_len_check
    check (char_length(contact_email) between 3 and 320),
  constraint sponsor_enquiries_website_len_check
    check (website is null or char_length(website) <= 300),
  constraint sponsor_enquiries_contact_name_len_check
    check (contact_name is null or char_length(contact_name) <= 120),
  constraint sponsor_enquiries_goals_len_check
    check (goals is null or char_length(goals) <= 4000),
  constraint sponsor_enquiries_terms_version_len_check
    check (char_length(terms_version) between 1 and 40),

  -- A key is only a key in an object. An array or a scalar here would make
  -- `interests->>'x'` mean something different depending on the row.
  constraint sponsor_enquiries_interests_is_object_check
    check (jsonb_typeof(interests) = 'object')
);

-- The one query an operator runs: the queue, oldest first.
create index if not exists sponsor_enquiries_queue_idx
  on public.sponsor_enquiries (status, created_at);

-- The one query rate limiting runs: "how many has this IP sent in an hour".
create index if not exists sponsor_enquiries_ip_recent_idx
  on public.sponsor_enquiries (ip_hash, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Enabled, and then every policy is an explicit deny — the same shape as
-- support_requests and waitlist_signups, for the same reason. The edge function
-- writes with the service role, which bypasses RLS by design, so nothing here
-- blocks the one writer that should exist.
-- ---------------------------------------------------------------------------

alter table public.sponsor_enquiries enable row level security;

-- No select for anyone. This is a pipeline of named companies and their terms.
create policy "sponsor_enquiries_select_denied"
  on public.sponsor_enquiries
  for select
  to anon, authenticated
  using (false);

-- No client insert. The website goes through the edge function so validation,
-- rate limiting and the terms check cannot be bypassed by calling PostgREST
-- directly with the publishable key.
create policy "sponsor_enquiries_insert_denied"
  on public.sponsor_enquiries
  for insert
  to anon, authenticated
  with check (false);

create policy "sponsor_enquiries_update_denied"
  on public.sponsor_enquiries
  for update
  to anon, authenticated
  using (false);

create policy "sponsor_enquiries_delete_denied"
  on public.sponsor_enquiries
  for delete
  to anon, authenticated
  using (false);

-- Belt and braces: no privileges for anon or authenticated on this table at all.
revoke all on public.sponsor_enquiries from anon, authenticated;
grant all on public.sponsor_enquiries to service_role;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

drop trigger if exists sponsor_enquiries_touch on public.sponsor_enquiries;
create trigger sponsor_enquiries_touch
  before update on public.sponsor_enquiries
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Documentation
-- ---------------------------------------------------------------------------

comment on table public.sponsor_enquiries is
  'Brand and sponsorship enquiries submitted through the /sponsors/ questionnaire on the website. Written only by the sponsor-enquiry edge function via the service role; no client role can read or write it. An enquiry is not a contract: nothing here creates a brand, a placement or a discount.';

comment on column public.sponsor_enquiries.interests is
  'Questionnaire answers as a JSON object, keyed by question. Object-only by constraint so a key is always a key. Absent means not asked; false means declined.';

comment on column public.sponsor_enquiries.sports is
  'Sports the deal should target. Empty means everyone, matching how brand_placements.sports is read, so an enquiry maps onto what can actually be delivered.';

comment on column public.sponsor_enquiries.terms_version is
  'Version of the brand and sponsorship enquiry terms accepted at submission. Recorded so a later change to the terms can be told apart from these answers.';

comment on column public.sponsor_enquiries.terms_accepted_at is
  'When the enquiry terms were accepted. The form cannot submit without accepting, and the edge function re-checks, so this is a fact with a date rather than an inference.';

comment on column public.sponsor_enquiries.ip_hash is
  'Salted hash of the client address, used only to rate-limit and investigate abuse. Not an identifier, not reused for anything else, and clearable.';

comment on column public.sponsor_enquiries.status is
  'Pipeline state. ''new'' is unread. ''active'' is set by hand after a brands row and placement are created — the only step that makes anything visible to an athlete.';
