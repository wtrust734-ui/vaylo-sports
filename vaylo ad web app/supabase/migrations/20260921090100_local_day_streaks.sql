-- Streaks counted the day in UTC while the app counts it in the athlete's own
-- timezone (src/lib/dates.ts). For anyone east of UTC an evening session landed
-- on the wrong day: the client showed one streak and the server another, so
-- streaks could double-count or silently break.
--
-- `touch_streak` now accepts the caller's local date. It is clamped to ±1 day
-- of the server date so a client cannot fast-forward its way to a longer
-- streak, while still tolerating every real UTC offset (max +14 / -12).

-- NOTE: p_date is deliberately NOT defaulted. If both `touch_streak()` and a
-- defaulted `touch_streak(date)` existed, an argument-less RPC call would be
-- ambiguous (PostgREST returns "could not choose the best candidate function").
CREATE OR REPLACE FUNCTION public.touch_streak(p_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row public.streaks%ROWTYPE;
  v_today date;
  v_yesterday date;
  v_two_ago date;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Trust the caller's calendar day, but never more than one day away.
  v_today := COALESCE(p_date, CURRENT_DATE); -- NULL falls back to the server day
  IF v_today > CURRENT_DATE + 1 THEN v_today := CURRENT_DATE + 1; END IF;
  IF v_today < CURRENT_DATE - 1 THEN v_today := CURRENT_DATE - 1; END IF;

  v_yesterday := v_today - 1;
  v_two_ago := v_today - 2;

  SELECT * INTO v_row FROM public.streaks WHERE user_id=v_user FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.streaks(user_id, current_streak, longest_streak, last_activity_date)
    VALUES (v_user, 1, 1, v_today) RETURNING * INTO v_row;
  ELSIF v_row.last_activity_date = v_today THEN
    -- already counted today
    NULL;
  ELSIF v_row.last_activity_date = v_yesterday THEN
    UPDATE public.streaks SET current_streak=current_streak+1,
      longest_streak=GREATEST(longest_streak, current_streak+1),
      last_activity_date=v_today, updated_at=now()
    WHERE user_id=v_user RETURNING * INTO v_row;
  ELSIF v_row.last_activity_date = v_two_ago AND (v_row.grace_used_on IS NULL OR v_row.grace_used_on < v_today - 14) THEN
    -- use grace day
    UPDATE public.streaks SET current_streak=current_streak+1,
      longest_streak=GREATEST(longest_streak, current_streak+1),
      last_activity_date=v_today, grace_used_on=v_today, updated_at=now()
    WHERE user_id=v_user RETURNING * INTO v_row;
  ELSIF v_row.freezes_available > 0 AND v_row.last_activity_date < v_yesterday THEN
    UPDATE public.streaks SET freezes_available=freezes_available-1,
      last_activity_date=v_today, updated_at=now()
    WHERE user_id=v_user RETURNING * INTO v_row;
  ELSE
    -- streak broken
    UPDATE public.streaks SET current_streak=1, last_activity_date=v_today, updated_at=now()
    WHERE user_id=v_user RETURNING * INTO v_row;
  END IF;
  RETURN jsonb_build_object('current', v_row.current_streak, 'longest', v_row.longest_streak, 'last', v_row.last_activity_date);
END $$;

-- Older client bundles call `touch_streak()` with no arguments, so keep that
-- exact signature working as a wrapper instead of dropping it (PostgREST
-- resolves an empty body to the zero-argument overload).
CREATE OR REPLACE FUNCTION public.touch_streak()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT public.touch_streak(CURRENT_DATE);
$$;

REVOKE ALL ON FUNCTION public.touch_streak(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.touch_streak() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_streak(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_streak() TO authenticated;
