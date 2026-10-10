// ============================================================================
// THE ACTIVE LOCALE — who we are formatting for
// ----------------------------------------------------------------------------
// This module exists so that a *pure* module can read the athlete's chosen
// language. It imports no React and touches no I/O, which lets decision code
// (`src/lib/sessionLoad.ts`, `src/lib/recoveryAdjust.ts`) format a number in the
// athlete's language while keeping the promise its header makes: no Supabase, no
// clock, no React.
//
// The formatters live in ./format, which needs React for its `useLocale` hook
// and would drag a UI framework into a decision function if a lib imported it.
// The number formatter is here instead, because numbers are what the pure
// modules need; the date formatters stayed in ./format.
//
// ./format re-exports everything public from here, so `from "@/i18n/format"`
// remains the one import a UI file needs.
// ============================================================================

/**
 * Resolve the Intl locale tag to format with.
 *
 * Rule: if the device locale's language matches the active Vaylo Sports language,
 * keep the device's full tag (an en-GB device keeps "22 September", an en-US
 * device keeps "September 22" — even after choosing English manually).
 * Otherwise use the bare language code and let Intl pick the region default.
 */
export function resolveLocale(lang: string): string {
  try {
    const nav = typeof navigator !== "undefined" ? navigator.language : undefined;
    if (nav && nav.toLowerCase().split(/[-_]/)[0] === lang.toLowerCase()) return nav;
  } catch { /* non-browser env */ }
  return lang;
}

// Exported as a live binding: ./format's date formatters read it directly, and
// an ESM importer always sees the value setFormattingLocale last wrote.
export let activeLocale = "en";

/** Sync the formatting locale with i18next. Called by the i18n init. */
export function setFormattingLocale(lang: string): void {
  activeLocale = resolveLocale(lang || "en");
}

/** Current Intl locale tag used by every formatter. */
export function getLocale(): string {
  return activeLocale;
}

/** "1,234.5" in en, "1.234,5" in de — the athlete's separators, not the device's. */
export function formatNumber(value: number, opts?: Intl.NumberFormatOptions): string {
  if (!isFinite(value)) return "—";
  return new Intl.NumberFormat(activeLocale, opts).format(value);
}
