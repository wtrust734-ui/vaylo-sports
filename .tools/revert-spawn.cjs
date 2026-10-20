// Reset the 2026-10-18 calendar day to a clean pending spawn state, and
// ensure the queued image job is back to run_after-now so a reachable
// future run picks it up immediately.
const { execSync } = require('child_process');
const fs = require('fs');
const { resolve } = require('path');

const cwd = process.cwd();
const file = resolve(__dirname, '_revert.sql');
const sql = `
-- put the spawn back to pending so the daily tick can re-materialise jobs
insert into public.ad_engine_spawns (calendar_day, state)
values ('2026-10-18', 'pending')
on conflict (calendar_day) do update set state = 'pending', spawned_at = null, attempts = 0;

-- ensure the calendar row itself is still planned/queued as appropriate
update public.ad_engine_calendar
set status = case when status not in ('completed','failed','published','approved','scheduled','generating')
                  then status else 'queued' end,
    updated_at = now()
where day = '2026-10-18' and status in ('completed','failed','published','approved','scheduled','generating');

-- reset the existing jobs for this day back to queued + due now
update public.ad_engine_jobs
set status = 'queued',
    attempts = 0,
    error = null,
    run_after = now() - interval '5 minutes',
    lease_until = null,
    claimed_by = null,
    completed_at = null,
    updated_at = now()
where calendar_day = '2026-10-18';
`;
fs.writeFileSync(file, sql, 'utf8');
console.log('written revert SQL');
try {
  const out = execSync('node scripts/run-sql-file.cjs ' + file, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 2e6,
    timeout: 60_000,
  });
  const body = out.split('HTTP 201: ').pop() || out.split('\n')[0];
  console.log('Revert result:', body.replace(/\n/g, ' | ').slice(0, 400));
} catch (e) {
  console.error('revert failed:', e.message);
  process.exit(1);
}
