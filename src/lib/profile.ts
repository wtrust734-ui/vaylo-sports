import { sportDisplayName } from "@/i18n/region";

export const parseSports = (sportValue?: string | null) =>
  (sportValue ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const getPrimarySport = (sportValue?: string | null) =>
  parseSports(sportValue)[0] ?? "General";

/**
 * DISPLAY of the athlete's sport list. Canonical names go in (stored data,
 * never touched); regional display names come out — a US athlete's stored
 * "Football" renders as "Soccer" here and only here. Logic sites keep using
 * `parseSports` / `getPrimarySport`, which stay canonical by design, so no
 * translation ever reaches a record, plan, filter or AI payload.
 */
export const formatSports = (sportValue?: string | null) => {
  const sports = parseSports(sportValue);

  if (sports.length === 0) return "Multi-Sport";
  const display = sports.map((s) => sportDisplayName(s));
  if (display.length <= 2) return display.join(" · ");

  return `${display.slice(0, 2).join(" · ")} +${display.length - 2}`;
};