// ============================================================================
// VAYLO SPORTS — country, continent and currency reference
// ----------------------------------------------------------------------------
// Countries are grouped by continent using the UN M49 geoscheme: it is an
// objective, citable standard, so no athlete's board placement depends on a
// judgement call about which federation their country belongs to. Two
// consequences worth knowing: Türkiye, Israel, Cyprus, Georgia, Armenia and
// Azerbaijan are Western Asia, and Russia is Eastern Europe.
//
// This module is deliberately dependency-free and pure so it can be unit-tested
// and reused unchanged when the app is wrapped for mobile.
// ============================================================================

export type Continent =
  | "Africa"
  | "Asia"
  | "Europe"
  | "North America"
  | "South America"
  | "Oceania";

export interface Country {
  /** ISO 3166-1 alpha-2, uppercase. This is what `user_region.country` stores. */
  code: string;
  name: string;
  continent: Continent;
  /** ISO 4217 code, used to seed the athlete's price tier. */
  currency: string;
}

type Row = [code: string, name: string, currency: string];

const EUROPE: Row[] = [
  ["AL", "Albania", "ALL"], ["AD", "Andorra", "EUR"], ["AT", "Austria", "EUR"],
  ["BY", "Belarus", "BYN"], ["BE", "Belgium", "EUR"], ["BA", "Bosnia and Herzegovina", "BAM"],
  ["BG", "Bulgaria", "BGN"], ["HR", "Croatia", "EUR"], ["CZ", "Czechia", "CZK"],
  ["DK", "Denmark", "DKK"], ["EE", "Estonia", "EUR"], ["FO", "Faroe Islands", "DKK"],
  ["FI", "Finland", "EUR"], ["FR", "France", "EUR"], ["DE", "Germany", "EUR"],
  ["GI", "Gibraltar", "GIP"], ["GR", "Greece", "EUR"], ["HU", "Hungary", "HUF"],
  ["IS", "Iceland", "ISK"], ["IE", "Ireland", "EUR"], ["IT", "Italy", "EUR"],
  ["XK", "Kosovo", "EUR"], ["LV", "Latvia", "EUR"], ["LI", "Liechtenstein", "CHF"],
  ["LT", "Lithuania", "EUR"], ["LU", "Luxembourg", "EUR"], ["MT", "Malta", "EUR"],
  ["MD", "Moldova", "MDL"], ["MC", "Monaco", "EUR"], ["ME", "Montenegro", "EUR"],
  ["NL", "Netherlands", "EUR"], ["MK", "North Macedonia", "MKD"], ["NO", "Norway", "NOK"],
  ["PL", "Poland", "PLN"], ["PT", "Portugal", "EUR"], ["RO", "Romania", "RON"],
  ["RU", "Russia", "RUB"], ["SM", "San Marino", "EUR"], ["RS", "Serbia", "RSD"],
  ["SK", "Slovakia", "EUR"], ["SI", "Slovenia", "EUR"], ["ES", "Spain", "EUR"],
  ["SE", "Sweden", "SEK"], ["CH", "Switzerland", "CHF"], ["UA", "Ukraine", "UAH"],
  ["GB", "United Kingdom", "GBP"], ["VA", "Vatican City", "EUR"],
];

const ASIA: Row[] = [
  ["AF", "Afghanistan", "AFN"], ["AM", "Armenia", "AMD"], ["AZ", "Azerbaijan", "AZN"],
  ["BH", "Bahrain", "BHD"], ["BD", "Bangladesh", "BDT"], ["BT", "Bhutan", "BTN"],
  ["BN", "Brunei", "BND"], ["KH", "Cambodia", "KHR"], ["CN", "China", "CNY"],
  ["CY", "Cyprus", "EUR"], ["GE", "Georgia", "GEL"], ["HK", "Hong Kong", "HKD"],
  ["IN", "India", "INR"], ["ID", "Indonesia", "IDR"], ["IR", "Iran", "IRR"],
  ["IQ", "Iraq", "IQD"], ["IL", "Israel", "ILS"], ["JP", "Japan", "JPY"],
  ["JO", "Jordan", "JOD"], ["KZ", "Kazakhstan", "KZT"], ["KW", "Kuwait", "KWD"],
  ["KG", "Kyrgyzstan", "KGS"], ["LA", "Laos", "LAK"], ["LB", "Lebanon", "LBP"],
  ["MO", "Macao", "MOP"], ["MY", "Malaysia", "MYR"], ["MV", "Maldives", "MVR"],
  ["MN", "Mongolia", "MNT"], ["MM", "Myanmar", "MMK"], ["NP", "Nepal", "NPR"],
  ["KP", "North Korea", "KPW"], ["OM", "Oman", "OMR"], ["PK", "Pakistan", "PKR"],
  ["PS", "Palestine", "ILS"], ["PH", "Philippines", "PHP"], ["QA", "Qatar", "QAR"],
  ["SA", "Saudi Arabia", "SAR"], ["SG", "Singapore", "SGD"], ["KR", "South Korea", "KRW"],
  ["LK", "Sri Lanka", "LKR"], ["SY", "Syria", "SYP"], ["TW", "Taiwan", "TWD"],
  ["TJ", "Tajikistan", "TJS"], ["TH", "Thailand", "THB"], ["TL", "Timor-Leste", "USD"],
  ["TR", "Türkiye", "TRY"], ["TM", "Turkmenistan", "TMT"], ["AE", "United Arab Emirates", "AED"],
  ["UZ", "Uzbekistan", "UZS"], ["VN", "Vietnam", "VND"], ["YE", "Yemen", "YER"],
];

const AFRICA: Row[] = [
  ["DZ", "Algeria", "DZD"], ["AO", "Angola", "AOA"], ["BJ", "Benin", "XOF"],
  ["BW", "Botswana", "BWP"], ["BF", "Burkina Faso", "XOF"], ["BI", "Burundi", "BIF"],
  ["CV", "Cabo Verde", "CVE"], ["CM", "Cameroon", "XAF"], ["CF", "Central African Republic", "XAF"],
  ["TD", "Chad", "XAF"], ["KM", "Comoros", "KMF"], ["CG", "Congo", "XAF"],
  ["CD", "DR Congo", "CDF"], ["CI", "Côte d'Ivoire", "XOF"], ["DJ", "Djibouti", "DJF"],
  ["EG", "Egypt", "EGP"], ["GQ", "Equatorial Guinea", "XAF"], ["ER", "Eritrea", "ERN"],
  ["SZ", "Eswatini", "SZL"], ["ET", "Ethiopia", "ETB"], ["GA", "Gabon", "XAF"],
  ["GM", "Gambia", "GMD"], ["GH", "Ghana", "GHS"], ["GN", "Guinea", "GNF"],
  ["GW", "Guinea-Bissau", "XOF"], ["KE", "Kenya", "KES"], ["LS", "Lesotho", "LSL"],
  ["LR", "Liberia", "LRD"], ["LY", "Libya", "LYD"], ["MG", "Madagascar", "MGA"],
  ["MW", "Malawi", "MWK"], ["ML", "Mali", "XOF"], ["MR", "Mauritania", "MRU"],
  ["MU", "Mauritius", "MUR"], ["MA", "Morocco", "MAD"], ["MZ", "Mozambique", "MZN"],
  ["NA", "Namibia", "NAD"], ["NE", "Niger", "XOF"], ["NG", "Nigeria", "NGN"],
  ["RW", "Rwanda", "RWF"], ["ST", "São Tomé and Príncipe", "STN"], ["SN", "Senegal", "XOF"],
  ["SC", "Seychelles", "SCR"], ["SL", "Sierra Leone", "SLE"], ["SO", "Somalia", "SOS"],
  ["ZA", "South Africa", "ZAR"], ["SS", "South Sudan", "SSP"], ["SD", "Sudan", "SDG"],
  ["TZ", "Tanzania", "TZS"], ["TG", "Togo", "XOF"], ["TN", "Tunisia", "TND"],
  ["UG", "Uganda", "UGX"], ["EH", "Western Sahara", "MAD"], ["ZM", "Zambia", "ZMW"],
  ["ZW", "Zimbabwe", "ZWL"],
];

const NORTH_AMERICA: Row[] = [
  ["AI", "Anguilla", "XCD"], ["AG", "Antigua and Barbuda", "XCD"], ["AW", "Aruba", "AWG"],
  ["BS", "Bahamas", "BSD"], ["BB", "Barbados", "BBD"], ["BZ", "Belize", "BZD"],
  ["BM", "Bermuda", "BMD"], ["BQ", "Caribbean Netherlands", "USD"], ["VG", "British Virgin Islands", "USD"],
  ["CA", "Canada", "CAD"], ["KY", "Cayman Islands", "KYD"], ["CR", "Costa Rica", "CRC"],
  ["CU", "Cuba", "CUP"], ["CW", "Curaçao", "ANG"], ["DM", "Dominica", "XCD"],
  ["DO", "Dominican Republic", "DOP"], ["SV", "El Salvador", "USD"], ["GL", "Greenland", "DKK"],
  ["GD", "Grenada", "XCD"], ["GP", "Guadeloupe", "EUR"], ["GT", "Guatemala", "GTQ"],
  ["HT", "Haiti", "HTG"], ["HN", "Honduras", "HNL"], ["JM", "Jamaica", "JMD"],
  ["MQ", "Martinique", "EUR"], ["MX", "Mexico", "MXN"], ["MS", "Montserrat", "XCD"],
  ["NI", "Nicaragua", "NIO"], ["PA", "Panama", "PAB"], ["PR", "Puerto Rico", "USD"],
  ["KN", "Saint Kitts and Nevis", "XCD"], ["LC", "Saint Lucia", "XCD"],
  ["VC", "Saint Vincent and the Grenadines", "XCD"], ["SX", "Sint Maarten", "ANG"],
  ["TT", "Trinidad and Tobago", "TTD"], ["TC", "Turks and Caicos Islands", "USD"],
  ["US", "United States", "USD"], ["VI", "US Virgin Islands", "USD"],
];

const SOUTH_AMERICA: Row[] = [
  ["AR", "Argentina", "ARS"], ["BO", "Bolivia", "BOB"], ["BR", "Brazil", "BRL"],
  ["CL", "Chile", "CLP"], ["CO", "Colombia", "COP"], ["EC", "Ecuador", "USD"],
  ["FK", "Falkland Islands", "FKP"], ["GF", "French Guiana", "EUR"], ["GY", "Guyana", "GYD"],
  ["PY", "Paraguay", "PYG"], ["PE", "Peru", "PEN"], ["SR", "Suriname", "SRD"],
  ["UY", "Uruguay", "UYU"], ["VE", "Venezuela", "VES"],
];

const OCEANIA: Row[] = [
  ["AS", "American Samoa", "USD"], ["AU", "Australia", "AUD"], ["CK", "Cook Islands", "NZD"],
  ["FJ", "Fiji", "FJD"], ["PF", "French Polynesia", "XPF"], ["GU", "Guam", "USD"],
  ["KI", "Kiribati", "AUD"], ["MH", "Marshall Islands", "USD"], ["FM", "Micronesia", "USD"],
  ["NR", "Nauru", "AUD"], ["NC", "New Caledonia", "XPF"], ["NZ", "New Zealand", "NZD"],
  ["NU", "Niue", "NZD"], ["NF", "Norfolk Island", "AUD"], ["MP", "Northern Mariana Islands", "USD"],
  ["PW", "Palau", "USD"], ["PG", "Papua New Guinea", "PGK"], ["PN", "Pitcairn Islands", "NZD"],
  ["WS", "Samoa", "WST"], ["SB", "Solomon Islands", "SBD"], ["TK", "Tokelau", "NZD"],
  ["TO", "Tonga", "TOP"], ["TV", "Tuvalu", "AUD"], ["VU", "Vanuatu", "VUV"],
  ["WF", "Wallis and Futuna", "XPF"],
];

const BY_CONTINENT: [Continent, Row[]][] = [
  ["Africa", AFRICA],
  ["Asia", ASIA],
  ["Europe", EUROPE],
  ["North America", NORTH_AMERICA],
  ["South America", SOUTH_AMERICA],
  ["Oceania", OCEANIA],
];

export const CONTINENTS: Continent[] = BY_CONTINENT.map(([c]) => c);

/** Every selectable country, sorted by name for a picker. */
export const COUNTRIES: Country[] = BY_CONTINENT
  .flatMap(([continent, rows]) => rows.map(([code, name, currency]) => ({ code, name, continent, currency })))
  .sort((a, b) => a.name.localeCompare(b.name));

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

/**
 * Normalises anything the outside world might hand us (lowercase, whitespace,
 * a full country name) to an ISO alpha-2 code, or null if it isn't a country we
 * know. Unknown input returns null rather than guessing a default — a wrong
 * country would silently put an athlete on the wrong board.
 */
export function normaliseCountryCode(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  if (raw.length === 2 && BY_CODE.has(raw.toUpperCase())) return raw.toUpperCase();
  const byName = COUNTRIES.find((c) => c.name.toLowerCase() === raw.toLowerCase());
  return byName?.code ?? null;
}

export function countryByCode(code: string | null | undefined): Country | null {
  if (!code) return null;
  return BY_CODE.get(code.toUpperCase()) ?? null;
}

export function countryName(code: string | null | undefined): string | null {
  return countryByCode(code)?.name ?? null;
}

export function continentFor(code: string | null | undefined): Continent | null {
  return countryByCode(code)?.continent ?? null;
}

export function currencyFor(code: string | null | undefined): string | null {
  return countryByCode(code)?.currency ?? null;
}

/** Regional-indicator flag emoji for a country code (e.g. GB -> 🇬🇧). */
export function countryFlag(code: string | null | undefined): string {
  const c = normaliseCountryCode(code);
  if (!c) return "🏳️";
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** Countries on a continent, for grouping a leaderboard. */
export function countriesIn(continent: Continent): Country[] {
  return COUNTRIES.filter((c) => c.continent === continent);
}
