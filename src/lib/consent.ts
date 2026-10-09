// ============================================================================
// CONSENT RECORDING
// ----------------------------------------------------------------------------
// The app asks an athlete to tick "I accept the Terms" before creating an
// account, and asks for health data implicitly by letting them log it. Both are
// consent events under UK GDPR. The ICO's accountability principle (Art. 5(2))
// means being able to DEMONSTRATE consent, not just to have asked for it — so
// both moments are stamped on the profile.
//
// This records agreement to data the app ALREADY holds. It collects no new
// personal data: three columns holding a timestamp and a version string.
//
// Two rules:
//   1. Never block the user on this. A failed stamp must not stop someone
//      signing in or logging a workout — the consent already happened; failing
//      to write a timestamp is our problem, not theirs.
//   2. Never overwrite. First acceptance is the one that matters. Re-consenting
//      after a policy update records a new version rather than rewriting
//      history, because "when did they agree to which version" is a question
//      we may have to answer.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";

/**
 * The version of the published Terms this build asks people to accept.
 *
 * It must equal the `<p class="meta">Version X.Y</p>` line at the top of
 * `legal/terms.html`, because that string is what goes into
 * `profiles.terms_version`. A record that names a version nobody can look up
 * is not a record of anything, and it was wrong before: this said 1.0 while the
 * published document was already at 1.2, so every acceptance on file pointed at
 * a text that had been replaced. `legalContentConsistency.test.ts` now fails if
 * the two drift apart again.
 *
 * Bumping this is also what makes the re-acceptance prompt appear: any profile
 * whose recorded `terms_version` differs from this string is asked to read the
 * current Terms (src/components/legal/TermsChangeNotice.tsx). Section 17 of
 * `legal/terms.html` promises exactly that, so the two move together.
 */
export const TERMS_VERSION = "1.4";

/**
 * Stamp acceptance of the Terms and Privacy Policy.
 *
 * Returns whether the row was actually written. It never throws and never
 * blocks the caller — see rule 1 above — but the answer matters to one caller
 * in particular: the re-acceptance prompt (TermsChangeNotice) must not tell an
 * athlete that a consent was recorded when the write failed. A fire-and-forget
 * signature would make "we recorded that" indistinguishable from "we tried".
 */
export async function recordTermsAcceptance(): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { error } = await supabase
      .from("profiles")
      .update({
        terms_accepted_at: new Date().toISOString(),
        terms_version: TERMS_VERSION,
      })
      .eq("user_id", user.id);
    if (error) {
      console.warn("Could not record terms acceptance:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    // Swallowed on purpose — see rule 1 above.
    console.warn("Could not record terms acceptance:", err);
    return false;
  }
}

/**
 * Stamp consent to process health and fitness data.
 *
 * Called when the athlete first logs health data themselves, which is the
 * earliest point at which they have necessarily decided to give us some. Left
 * unset for an athlete who never logs any, which is the correct answer: they
 * have not consented to health processing because they never gave us any.
 */
export async function recordHealthConsent(): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    // Only set if unset: `.is("health_consent_at", null)` means this cannot
    // overwrite an earlier consent or silently refresh it.
    await supabase
      .from("profiles")
      .update({ health_consent_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("health_consent_at", null);
  } catch (err) {
    console.warn("Could not record health consent:", err);
  }
}
