// Click telemetry for the referral programme landing.
// ---------------------------------------------------------------------------
// Records that an invite link was opened. Stores only the invite code and the
// time — no account identity, no IP, no device fingerprint, no referrer
// identity beyond what the athlete typed into /referrals themselves. This is
// the anonymous aggregate behind “clicks recorded on the landing”, not a
// user-readable feed of other people's activity.
// ===========================================================================

import { supabase } from '@/integrations/supabase/client';

/** The generated Database types do not yet know referral_clicks, so the insert
 * is typed through a string-typed from() boundary — the same pattern the admin
 * referral console uses for recently migrated tables. */
export async function recordReferralClick(code: string): Promise<void> {
  if (!code.trim()) return;
  try {
    const { error } = await (supabase as unknown as { from: (table: string) => { insert: (values: Record<string, string>) => Promise<{ error: unknown }> } }).from('referral_clicks').insert({ code: code.trim().toUpperCase() });
    if (error) {
      // Click recording is telemetry, not purchase attribution. A failure here
      // must never block the auth flow or show an athlete an error about sharing.
    }
  } catch {
    // Network/shape failures are not user-facing either.
  }
}
