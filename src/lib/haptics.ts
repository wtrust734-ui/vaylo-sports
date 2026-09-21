// ============================================================================
// HAPTICS
// ----------------------------------------------------------------------------
// Physical feedback is one of the biggest differences between the web app and
// the native one. These helpers are safe to call from anywhere today: on the
// web they use the Vibration API when available, and inside Capacitor they
// switch to the real Taptic/Vibrator engine. They never throw.
// ============================================================================

import { loadPlugin } from "@/lib/platform";

type ImpactStyle = "light" | "medium" | "heavy";

interface HapticsPlugin {
  impact: (options: { style: ImpactStyle }) => Promise<void>;
  notification: (options: { type: "success" | "warning" | "error" }) => Promise<void>;
  vibrate: (options: { duration: number }) => Promise<void>;
  selectionChanged: () => Promise<void>;
}

const vibrate = (pattern: number | number[]) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Ignore — unsupported or blocked.
  }
};

const withHaptics = async (fn: (plugin: HapticsPlugin) => Promise<void>, pattern: number | number[]) => {
  const plugin = await loadPlugin<HapticsPlugin>("haptics");
  if (plugin) {
    try {
      await fn(plugin);
      return;
    } catch {
      // Fall through to vibration.
    }
  }
  vibrate(pattern);
};

/** A light tick — selecting a chip, a nav tap. */
export const hapticTap = () => withHaptics((h) => h.selectionChanged(), 8);

/** Something landed: a save, a purchase, a completed set. */
export const hapticSuccess = () => withHaptics((h) => h.notification({ type: "success" }), [12, 40, 18]);

/** Something needs attention: a failed write, a blocked purchase. */
export const hapticWarning = () => withHaptics((h) => h.notification({ type: "warning" }), [20, 60, 20]);

/** A bigger moment: a reward reveal, a milestone. */
export const hapticImpact = (style: ImpactStyle = "medium") =>
  withHaptics((h) => h.impact({ style }), style === "heavy" ? 40 : style === "medium" ? 24 : 12);
