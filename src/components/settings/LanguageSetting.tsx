import { useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Languages, Check, ChevronRight } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { LANGUAGES, AUTO, loadLanguagePref, type LanguagePref } from "@/i18n/languages";
import { applyLanguage } from "@/i18n";

// ============================================================================
// LANGUAGE SETTING — lives inside Profile → Settings.
//
// "Automatic" follows the device language (web: navigator.language; in the
// Capacitor WebViews this is the OS locale, so no native plugin is needed).
// A specific language overrides the device until the user returns to Automatic.
// The choice persists in localStorage (web + native) and is applied instantly —
// no reload, no logout; RTL flips live because <html dir> is updated by the
// same applyLanguage() call.
// ============================================================================

const LanguageSetting = () => {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // The current *effective* language and the stored preference. When they
  // differ (e.g. device is fr but Vaylo Sports fell back to en), the picker still
  // shows what the user selected.
  const [pref, setPref] = useState<LanguagePref>(() => loadLanguagePref());

  const choose = async (next: LanguagePref) => {
    if (next === pref || saving) { setOpen(false); return; }
    setSaving(true); // disables every option below → no racing applyLanguage calls
    try {
      await applyLanguage(next);
      setPref(next);
      // Toast feedback uses the NEW language because applyLanguage already
      // switched i18n before this line runs.
      toast({ title: t("settings.languageChanged") });
    } finally {
      setSaving(false);
      setOpen(false);
    }
  };

  const currentLabel =
    pref === AUTO
      ? t("settings.languageAutomatic")
      : LANGUAGES.find((l) => l.code === pref)?.nativeName ?? t("settings.language");

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Languages size={16} /> {t("settings.language")}
        </span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {currentLabel}
          <motion.span animate={{ rotate: open ? 90 : 0 }}>
            <ChevronRight size={16} />
          </motion.span>
        </span>
      </button>
      <p className="text-[11px] text-muted-foreground mt-1">{t("settings.languageDesc")}</p>

      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-2 space-y-1 overflow-hidden"
          role="listbox"
          aria-label={t("settings.language")}
          aria-busy={saving}
        >
          {/* Automatic — device language */}
          <button
            type="button"
            role="option"
            aria-selected={pref === AUTO}
            onClick={() => choose(AUTO)}
            className={`w-full rounded-lg px-3 py-2.5 text-start transition-colors ${pref === AUTO ? "bg-primary/15" : "hover:bg-muted/50"}`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold truncate">{t("settings.languageAutomatic")}</span>
                <span className="block text-[11px] text-muted-foreground">{t("settings.languageAutomaticDesc")}</span>
              </span>
              {pref === AUTO && <Check size={16} className="shrink-0 text-primary" />}
            </span>
          </button>

          {/* Explicit languages — native names, as is convention for pickers */}
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              role="option"
              aria-selected={pref === l.code}
              onClick={() => choose(l.code)}
              className={`w-full rounded-lg px-3 py-2.5 text-start transition-colors ${pref === l.code ? "bg-primary/15" : "hover:bg-muted/50"}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold truncate">{l.nativeName}</span>
                  <span className="block text-[11px] text-muted-foreground">{l.name}</span>
                </span>
                {pref === l.code && <Check size={16} className="shrink-0 text-primary" />}
              </span>
            </button>
          ))}
        </motion.div>
      )}
    </div>
  );
};

export default LanguageSetting;
