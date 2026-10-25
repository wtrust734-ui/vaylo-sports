-- Two live defects in the video path.
--
-- 1. ad_video_render_jobs_status_check was created for the old worker-only
--    states. ads-video now writes "handed_to_manus" and manus-invoke writes
--    "editing", so every handoff update failed its CHECK and the row stayed
--    "queued" while the API claimed the editor had it. The agent's claim then
--    500'd ("Could not record the progress") and no render could ever start.
-- 2. ad_video_shots had no record of how many provider attempts a shot has
--    used, so a transient provider rejection (INVALID_ARGUMENT with no clip and
--    no charge) could only be retried by hand.

alter table public.ad_video_render_jobs
  drop constraint if exists ad_video_render_jobs_status_check;

alter table public.ad_video_render_jobs
  add constraint ad_video_render_jobs_status_check
  check (status in ('queued', 'preparing', 'rendering', 'handed_to_manus', 'editing', 'done', 'failed'));

alter table public.ad_video_shots
  add column if not exists attempts integer not null default 1 check (attempts >= 1);
