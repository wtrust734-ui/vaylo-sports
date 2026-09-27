// ============================================================================
// I18N CORE — i18next setup, language switching, RTL, persistence
// ----------------------------------------------------------------------------
// Flow: device language → supported? → that language : English.
// Manual choice overrides device; English is the per-key fallback so a missing
// translation can never render as a raw key.
// ============================================================================

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en/index.json";
import {
  AUTO,
  type LanguageCode,
  type LanguagePref,
  detectDeviceLanguage,
  isRtlLanguage,
  isSupportedLanguage,
  loadLanguagePref,
  saveLanguagePref,
} from "./languages";
import { setFormattingLocale } from "./format";

/** English ships with the app — it is the fallback for every missing key. */
const FALLBACK = "en" as const;

// Non-English bundles are code-split: only the active language loads.
const LAZY_LOADERS: Record<Exclude<LanguageCode, typeof FALLBACK>, () => Promise<{ default: Record<string, unknown> }>> = {
  es: () => import("./locales/es/index.json"),
  fr: () => import("./locales/fr/index.json"),
  de: () => import("./locales/de/index.json"),
  pt: () => import("./locales/pt/index.json"),
  it: () => import("./locales/it/index.json"),
  nl: () => import("./locales/nl/index.json"),
  ar: () => import("./locales/ar/index.json"),
  zh: () => import("./locales/zh/index.json"),
  ja: () => import("./locales/ja/index.json"),
  ko: () => import("./locales/ko/index.json"),
  hi: () => import("./locales/hi/index.json"),
};

const loadedLanguages = new Set<string>([FALLBACK]);

async function ensureResources(code: LanguageCode): Promise<void> {
  if (loadedLanguages.has(code) || code === FALLBACK) return;
  const loader = LAZY_LOADERS[code as Exclude<LanguageCode, typeof FALLBACK>];
  if (!loader) return;
  const mod = await loader();
  i18n.addResourceBundle(code, "translation", mod.default, true, true);
  loadedLanguages.add(code);
}

/** Reflect language + direction on the document (a11y: screen readers, RTL). */
function applyDocumentLanguage(code: string): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.lang = code;
  html.dir = isRtlLanguage(code) ? "rtl" : "ltr";
}

i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: FALLBACK, // real language is applied by applyLanguage() below, before render matters
  fallbackLng: FALLBACK,
  // A missing key in the active language must render the English string,
  // never the raw key, never an empty string.
  returnEmptyString: false,
  interpolation: { escapeValue: false }, // React already escapes
});

// Keep the Intl formatting locale in lock-step with the UI language.
i18n.on("languageChanged", (lng) => {
  setFormattingLocale(lng);
  applyDocumentLanguage(lng);
});

/**
 * Resolve the effective language from a preference.
 * "auto" → device language (→ English if unsupported).
 */
export function resolvePrefToLanguage(pref: LanguagePref): LanguageCode {
  return pref === AUTO ? detectDeviceLanguage() : pref;
}

/**
 * Switch the whole app to `pref`. Loads the bundle lazily, persists the
 * choice, updates html lang/dir and the Intl formatting locale. Falls back
 * to English on any failure so the UI keeps working.
 */
export async function applyLanguage(pref: LanguagePref): Promise<LanguageCode> {
  const target = resolvePrefToLanguage(pref);
  saveLanguagePref(pref);
  try {
    await ensureResources(target);
    await i18n.changeLanguage(target);
  } catch {
    // Bundle failed to load — English fallback is already registered.
    if (i18n.language !== FALLBACK) await i18n.changeLanguage(FALLBACK);
  }
  return (isSupportedLanguage(i18n.language) ? i18n.language : FALLBACK) as LanguageCode;
}

/** Called once at app startup, before the first render paints text. */
export async function initI18n(): Promise<void> {
  // localStorage wins (survives sessions, works signed-out);
  // applyLanguage persists the resolved pref so reopening is stable.
  await applyLanguage(loadLanguagePref());
}

/**
 * The language tag AI generation must produce content in. Attached to every
 * AI request body by aiService.ts and the dedicated edge functions.
 */
export function getAiLocale(): string {
  const lang = i18n.language?.split(/[-_]/)[0];
  return isSupportedLanguage(lang || "") ? (lang as string) : FALLBACK;
}

/** True while the active language lays out right-to-left. */
export function isCurrentLanguageRtl(): boolean {
  return isRtlLanguage(i18n.language);
}

export default i18n;
