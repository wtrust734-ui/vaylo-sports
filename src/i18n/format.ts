// ============================================================================
// LOCALE FORMATTING — dates, times, numbers, relative time
// ----------------------------------------------------------------------------
// Every user-facing format goes through here so the UI follows the selected
// Vaylo Sports language, not the browser default and not hard-coded "en".
// Units are deliberately NOT part of this module: language ≠ units, and unit
// preference stays a separate concern (see docs/INTERNATIONALIZATION.md).
// ============================================================================

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Resolve the Intl locale tag to format with.
 *
 * Rule: if the device locale's language matches the active Vaylo Sports language,
 * keep the device's full tag (an en-GB device keeps "22 September", an en-US
 * device keeps "September 22" — even after choosing English manually).
 * Otherwise use the bare language code and let Intl pick the region default.
 */
function resolveLocale(lang: string): string {
  try {
    const nav = typeof navigator !== "undefined" ? navigator.language : undefined;
    if (nav && nav.toLowerCase().split(/[-_]/)[0] === lang.toLowerCase()) return nav;
  } catch { /* non-browser env */ }
  return lang;
}

let activeLocale = "en";

/** Sync the formatting locale with i18next. Called by the i18n init. */
export function setFormattingLocale(lang: string): void {
  activeLocale = resolveLocale(lang || "en");
}

/** Current Intl locale tag used by every formatter below. */
export function getLocale(): string {
  return activeLocale;
}

/* ------------------------------- dates ---------------------------------- */

export function formatDate(date: Date | string | number, opts?: Intl.DateTimeFormatOptions): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(activeLocale, opts).format(d);
}

/** "22 September 2026" / "September 22, 2026" per locale. */
export function formatFullDate(date: Date | string | number): string {
  return formatDate(date, { day: "numeric", month: "long", year: "numeric" });
}

/** "22 Sep" / "Sep 22" per locale — the compact form used in chart axes and lists. */
export function formatShortDate(date: Date | string | number): string {
  return formatDate(date, { day: "numeric", month: "short" });
}

/** "16:30" / "4:30 PM" per locale. */
export function formatTime(date: Date | string | number): string {
  return formatDate(date, { hour: "numeric", minute: "2-digit" });
}

/** Date + time in one string, per locale. */
export function formatDateTime(date: Date | string | number): string {
  return formatDate(date, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Weekday + long date for event screens: "Tuesday, 22 September 2026". */
export function formatWeekdayDate(date: Date | string | number): string {
  return formatDate(date, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/**
 * "3 days ago" / "in 2 weeks" per locale. `granularity` caps the unit so
 * timelines stay readable ("3 days ago" rather than "72 hours ago").
 */
export function formatRelativeTime(date: Date | string | number, granularity: "day" | "hour" = "day"): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return "—";
  try {
    const rtf = new Intl.RelativeTimeFormat(activeLocale, { numeric: "auto" });
    const diffMs = d.getTime() - Date.now();
    const absMs = Math.abs(diffMs);
    if (granularity === "hour" || absMs < 22 * 3600 * 1000) {
      const hours = Math.round(diffMs / 3600000);
      if (Math.abs(hours) < 1) {
        const minutes = Math.round(diffMs / 60000);
        return rtf.format(minutes, "minute");
      }
      return rtf.format(hours, "hour");
    }
    const days = Math.round(diffMs / 86400000);
    if (Math.abs(days) < 28) return rtf.format(days, "day");
    const months = Math.round(days / 30);
    if (Math.abs(months) < 12) return rtf.format(months, "month");
    return rtf.format(Math.round(months / 12), "year");
  } catch {
    return formatShortDate(d);
  }
}

/* ------------------------------ numbers --------------------------------- */

/** Locale-aware number: 12,345 / 12.345 per locale. */
export function formatNumber(value: number, opts?: Intl.NumberFormatOptions): string {
  if (!isFinite(value)) return "—";
  return new Intl.NumberFormat(activeLocale, opts).format(value);
}

/** Compact form for large counts: 12.3K / 12,3 k per locale. */
export function formatCompactNumber(value: number): string {
  if (!isFinite(value)) return "—";
  return new Intl.NumberFormat(activeLocale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** Percentages: 0.823 → "82%" / "82 %" per locale. */
export function formatPercent(fraction: number, fractionDigits = 0): string {
  if (!isFinite(fraction)) return "—";
  return new Intl.NumberFormat(activeLocale, { style: "percent", maximumFractionDigits: fractionDigits }).format(fraction);
}

/**
 * React hook returning the current locale tag; re-renders on language change.
 * Use for inline Intl calls in components that don't go through the helpers.
 */
export function useLocale(): string {
  const { i18n } = useTranslation();
  const [locale, setLocale] = useState(() => resolveLocale(i18n.language));
  useEffect(() => {
    setLocale(resolveLocale(i18n.language));
    const handler = (lang: string) => setLocale(resolveLocale(lang));
    i18n.on("languageChanged", handler);
    return () => i18n.off("languageChanged", handler);
  }, [i18n]);
  return locale;
}
