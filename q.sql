update public.ad_engine_jobs set run_after=now()-interval '1 min', attempts=0, error=null where status='queued';
