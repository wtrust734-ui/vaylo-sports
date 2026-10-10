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

import { activeLocale, resolveLocale } from "./locale";

// The locale state itself and the number formatter live in ./locale, which
// imports no React, so that pure decision modules can format a number in the
// athlete's language without pulling a UI framework into a decision function.
// Re-exported here so a UI file still needs exactly one import.
export { formatNumber, getLocale, setFormattingLocale } from "./locale";

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

/**
 * The full numeric date and time — the shape a bare `toLocaleString()` produced.
 *
 * The drop-in for that call, so an existing site can be routed through this
 * module without changing what an English reader sees, while gaining the
 * athlete's chosen language: a bare `toLocaleString()` follows the DEVICE
 * locale, which is how an English phone kept printing English dates in a German
 * app. `formatDateTime` above is the shorter form for new copy.
 */
export function formatDateTimeExact(date: Date | string | number): string {
  return formatDate(date, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
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
// `formatNumber` is defined in ./locale and re-exported above.

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
