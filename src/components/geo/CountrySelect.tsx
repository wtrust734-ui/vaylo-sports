import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Check, X, Globe } from "lucide-react";
import { COUNTRIES, CONTINENTS, countryFlag, normaliseCountryCode, type Country } from "@/lib/geo";

interface Props {
  /** Selected ISO alpha-2 code, or null. */
  value: string | null;
  onChange: (code: string | null) => void;
  /** "field" renders as a tappable row, "inline" renders the list open. */
  variant?: "field" | "inline";
  label?: string;
  allowClear?: boolean;
}

/**
 * Country picker. 200+ options is too many for a chip grid, so this is a search
 * field over a continent-grouped list — fast to scan, and it works as a plain
 * inline list so it can be dropped into a step or a settings sheet unchanged.
 */
const CountrySelect = ({ value, onChange, variant = "field", label = "Country", allowClear = false }: Props) => {
  const [open, setOpen] = useState(variant === "inline");
  const [query, setQuery] = useState("");

  const selected = useMemo(() => {
    const code = normaliseCountryCode(value);
    return code ? COUNTRIES.find((c) => c.code === code) ?? null : null;
  }, [value]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    // Match on name or code, so "gb", "united kingdom" and "kingdom" all work.
    return COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q);
  }, [query]);

  const grouped = useMemo(
    () => CONTINENTS
      .map((continent) => ({ continent, countries: results.filter((c) => c.continent === continent) }))
      .filter((g) => g.countries.length > 0),
    [results],
  );

  const pick = (c: Country) => {
    onChange(c.code);
    setOpen(false);
    setQuery("");
  };

  const list = (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search countries"
          autoFocus
          aria-label="Search countries"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-card border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      <div className="max-h-72 overflow-y-auto -mx-1 px-1 space-y-3">
        {grouped.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">No country matches “{query}”.</p>
        )}
        {grouped.map(({ continent, countries }) => (
          <div key={continent}>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold mb-1.5">{continent}</p>
            <div className="space-y-1">
              {countries.map((c) => {
                const isSelected = c.code === selected?.code;
                return (
                  <button
                    key={c.code}
                    onClick={() => pick(c)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border text-start text-sm transition-colors ${
                      isSelected ? "bg-primary/15 border-primary text-primary" : "bg-card border-border hover:border-primary/40"
                    }`}
                  >
                    <span className="text-base leading-none">{countryFlag(c.code)}</span>
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-[10px] text-muted-foreground">{c.currency}</span>
                    {isSelected && <Check size={14} />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  if (variant === "inline") return list;

  return (
    <div className="space-y-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-3 rounded-xl border border-border bg-card text-start text-sm hover:border-primary/40 transition-colors"
        aria-label={`Choose your ${label.toLowerCase()}`}
      >
        <span className="text-base leading-none">{selected ? countryFlag(selected.code) : <Globe size={16} className="text-muted-foreground" />}</span>
        <span className={`flex-1 truncate ${selected ? "" : "text-muted-foreground"}`}>
          {selected ? selected.name : `Choose your ${label.toLowerCase()}`}
        </span>
        {selected && allowClear && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear country"
            onClick={(e) => { e.stopPropagation(); onChange(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onChange(null); } }}
            className="p-0.5 rounded hover:bg-muted"
          >
            <X size={14} className="text-muted-foreground" />
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="pt-2">{list}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default CountrySelect;
