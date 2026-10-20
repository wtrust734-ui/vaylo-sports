create or replace function public.ad_engine_note_spend(p_amount_gbp numeric)
returns numeric language plpgsql security definer as $$
declare v_now numeric;
begin
  if p_amount_gbp is null or p_amount_gbp <= 0 then return 0; end if;
  update public.ad_engine_budget
    set spent_production_gbp = least(ceiling_gbp, spent_production_gbp + p_amount_gbp),
        updated_at = now()
    where campaign = 'vaylo-sports-2026'
    returning spent_production_gbp into v_now;
  return v_now;
end; $$;
grant execute on function public.ad_engine_note_spend(numeric) to service_role;
