-- Rewrite every RLS policy in `public` so auth.*() is evaluated once per query
-- rather than once per row.
--
-- The `auth_rls_initplan` advisor flagged 147 policies. A bare `auth.uid()` in a
-- policy predicate is re-evaluated for every row the policy touches;
-- `(select auth.uid())` is hoisted into an InitPlan and evaluated once. The
-- result is identical — this is purely how many times the JWT claim lookup runs
-- — but on a scan it is the difference between one lookup and N.
--
-- Written as a catalogue walk rather than 147 hand-copied statements, and
-- deliberately idempotent: the first `regexp_replace` unwraps an existing
-- `(select auth.uid())` before the second re-wraps it, so re-running this (or
-- running it over policies that already follow the convention) can never
-- accumulate nested selects. Policies are altered in place, so their roles and
-- permissive/restrictive mode are untouched — only the predicate text changes.
--
-- Only a select whose entire body is an auth.*()/current_setting() call is
-- unwrapped (`(select auth.uid())`), never a real subquery like
-- `exists (select 1 from ...)`.

do $do$
declare
  r record;
  v_using text;
  v_check text;
  v_sql text;
  n integer := 0;
  v_unwrap constant text := '\(\s*select\s+(auth\.(uid|jwt|role)\(\)|current_setting\s*\([^)]*\))\s*\)';
  v_wrap constant text := '(auth\.(uid|jwt|role)\(\)|current_setting\s*\([^)]*\))';
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        coalesce(qual, '') ~* v_wrap
        or coalesce(with_check, '') ~* v_wrap
      )
  loop
    v_using := r.qual;
    v_check := r.with_check;

    if v_using is not null then
      v_using := regexp_replace(v_using, v_unwrap, '\1', 'gi');
      v_using := regexp_replace(v_using, v_wrap, '(select \1)', 'gi');
    end if;

    if v_check is not null then
      v_check := regexp_replace(v_check, v_unwrap, '\1', 'gi');
      v_check := regexp_replace(v_check, v_wrap, '(select \1)', 'gi');
    end if;

    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if v_using is not null then
      v_sql := v_sql || format(' using (%s)', v_using);
    end if;
    if v_check is not null then
      v_sql := v_sql || format(' with check (%s)', v_check);
    end if;

    execute v_sql;
    n := n + 1;
  end loop;

  raise notice 'rls initplan: rewrote % policies', n;
end
$do$;
