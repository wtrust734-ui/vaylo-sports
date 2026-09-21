export const parseSports = (sportValue?: string | null) =>
  (sportValue ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const getPrimarySport = (sportValue?: string | null) =>
  parseSports(sportValue)[0] ?? "General";

export const formatSports = (sportValue?: string | null) => {
  const sports = parseSports(sportValue);

  if (sports.length === 0) return "Multi-Sport";
  if (sports.length <= 2) return sports.join(" · ");

  return `${sports.slice(0, 2).join(" · ")} +${sports.length - 2}`;
};