// ============================================================================
// VAYLO HEALTH — permission catalog (the ONLY place permissions are declared)
// ----------------------------------------------------------------------------
// Mirrors native/health-connect/.../HealthPermissions.kt (VERSION must match).
// The UI shows exactly this list to the athlete before asking; nothing is
// requested "because the API offers it". Adding a data type later = one entry
// here + one in the native catalog + a VERSION bump; the stored consent version
// mismatch surfaces as an explicit re-consent in the UI, never a silent prompt.
// ============================================================================

export interface HealthPermissionSpec {
  /** Human label shown in the settings UI. */
  label: string;
  /** Why Vaylo Sports requests it — shown under Data permissions. */
  why: string;
}

/** Version contract with HealthPermissions.kt — keep both in lockstep. */
export const HEALTH_PERMISSIONS_VERSION = 1;

export const HEALTH_DATA_PERMISSIONS: Record<string, HealthPermissionSpec> = {
  workouts: { label: "Workouts", why: "Import training sessions into your log" },
  heart_rate: { label: "Heart rate", why: "Training intensity and recovery analysis" },
  distance: { label: "Distance", why: "Running, cycling and swimming volumes" },
  steps: { label: "Steps", why: "Daily activity and readiness context" },
  sleep: { label: "Sleep", why: "Recovery insights between sessions" },
  calories: { label: "Calories", why: "Energy expenditure for fuelling guidance" },
};

/** Ordered list for rendering. */
export const HEALTH_PERMISSION_LIST = Object.entries(HEALTH_DATA_PERMISSIONS);
