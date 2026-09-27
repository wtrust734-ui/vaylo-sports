// ============================================================================
// LANGUAGE REGISTRY — the single source of truth for Vaylo Sports's locales
// ----------------------------------------------------------------------------
// Adding a language = add one entry here + one folder under src/i18n/locales.
// Nothing else in the app hard-codes the list (the settings UI renders from
// LANGUAGES, detection validates against it, AI passes locale through).
// ============================================================================

export type LanguageCode =
  | "en" | "es" | "fr" | "de" | "pt" | "it"
  | "nl" | "ar" | "zh" | "ja" | "ko" | "hi";

export interface LanguageDef {
  code: LanguageCode;
  /** English name (for the settings list) */
  name: string;
  /** Native name shown in the language picker */
  nativeName: string;
  /** true for RTL scripts (Arabic today; add Hebrew/Persian/Urdu here later) */
  rtl: boolean;
}

export const LANGUAGES: LanguageDef[] = [
  { code: "en", name: "English", nativeName: "English", rtl: false },
  { code: "es", name: "Spanish", nativeName: "Español", rtl: false },
  { code: "fr", name: "French", nativeName: "Français", rtl: false },
  { code: "de", name: "German", nativeName: "Deutsch", rtl: false },
  { code: "pt", name: "Portuguese", nativeName: "Português", rtl: false },
  { code: "it", name: "Italian", nativeName: "Italiano", rtl: false },
  { code: "nl", name: "Dutch", nativeName: "Nederlands", rtl: false },
  { code: "ar", name: "Arabic", nativeName: "العربية", rtl: true },
  { code: "zh", name: "Chinese", nativeName: "中文", rtl: false },
  { code: "ja", name: "Japanese", nativeName: "日本語", rtl: false },
  { code: "ko", name: "Korean", nativeName: "한국어", rtl: false },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी", rtl: false },
];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as LanguageCode[];

export const RTL_LANGUAGES: LanguageCode[] = LANGUAGES.filter((l) => l.rtl).map((l) => l.code);

export const isRtlLanguage = (code: string): boolean =>
  RTL_LANGUAGES.includes(code as LanguageCode);

export const isSupportedLanguage = (code: string): code is LanguageCode =>
  LANGUAGE_CODES.includes(code as LanguageCode);

export const languageDef = (code: string): LanguageDef | undefined =>
  LANGUAGES.find((l) => l.code === code);

/**
 * The stored preference value meaning "detect from the device".
 * Stored as the literal "auto" so persistence needs no schema ceremony.
 */
export const AUTO = "auto" as const;
export type LanguagePref = LanguageCode | typeof AUTO;

export const LANGUAGE_PREF_STORAGE_KEY = "vaylo.languagePref";

/** Read the persisted preference (localStorage survives web + native WebView). */
export function loadLanguagePref(): LanguagePref {
  try {
    const raw = localStorage.getItem(LANGUAGE_PREF_STORAGE_KEY);
    return raw === AUTO || isSupportedLanguage(raw) ? raw : AUTO;
  } catch {
    return AUTO;
  }
}

/** Persist the preference; returns false if storage is unavailable. */
export function saveLanguagePref(pref: LanguagePref): boolean {
  try {
    localStorage.setItem(LANGUAGE_PREF_STORAGE_KEY, pref);
    return true;
  } catch {
    return false;
  }
}

/**
 * Device locale detection. `navigator.language` is the OS locale inside the
 * Android and iOS WebViews, so this one implementation covers web + Capacitor
 * without a native plugin. Falls back through full tag → base language.
 */
export function detectDeviceLanguage(): LanguageCode {
  const candidates: string[] = [];
  if (typeof navigator !== "undefined") {
    if (navigator.language) candidates.push(navigator.language);
    if (Array.isArray(navigator.languages)) candidates.push(...navigator.languages);
  }
  for (const tag of candidates) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (isSupportedLanguage(base)) return base as LanguageCode;
  }
  return "en";
}
