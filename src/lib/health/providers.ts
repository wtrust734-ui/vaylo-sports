// ===========================================================================
// VAYLO HEALTH — wearable provider catalog (SINGLE SOURCE OF TRUTH)
// ---------------------------------------------------------------------------
// Every wearable / service Vaylo Sports can sync from is declared here and nowhere
// else. The UI, the sync engine, the OAuth layer and the native bridges read
// this catalog. Adding a new device = one entry here + (if cloud) one edge-
// function secret set.
//
// Two sync families:
//   • native  — on-device hub (Health Connect on Android, HealthKit on iOS).
//               The watch writes into the phone's health store; Vaylo Sports pulls
//               from the store. No cloud OAuth, no background jobs.
//   • cloud   — OAuth to the vendor's API (Garmin, Fitbit, Polar, …). Tokens
//               are held server-side (edge function + Supabase Vault) and
//               imported only when the athlete taps Sync.
//
// Every device the athlete actually owns on the requested list already feeds
// one of these paths: Samsung / Google / Fitbit / Garmin / Polar / COROS /
// WHOOP / Oura all write into Health Connect on Android today; Apple Watch
// writes into HealthKit on iOS. Cloud OAuth gives a direct path for athletes
// who prefer it and for watches that do not bridge locally.
// ===========================================================================

export type SyncFamily = "native" | "cloud";
export type WearableProviderId =
  | "health_connect"
  | "healthkit"
  | "garmin"
  | "fitbit"
  | "polar"
  | "coros"
  | "whoop"
  | "oura"
  | "samsung_health"
  | "google_fit"
  | "suunto"
  | "withings"
  | "strava"
  | "huawei";

export interface WearableProviderSpec {
  id: WearableProviderId;
  label: string;
  /** Short subtitle under the label (watch / service name). */
  subtitle: string;
  family: SyncFamily;
  /** Where this provider is usable. */
  platforms: ("android" | "ios" | "web")[];
  /** One-liner shown in the provider card. */
  blurb: string;
  /** Longer rationale shown in expanded detail / privacy note. */
  why: string;
  /** True when this device writes into Health Connect on Android (no extra OAuth needed). */
  healthConnectBridged: boolean;
  /** True when this device writes into HealthKit on iOS. */
  healthKitBridged: boolean;
  /** Vendor OAuth docs / connect help (shown as external link when not yet connected). */
  helpUrl?: string;
  /** Brand accent (used for the small provider badge). */
  accent: string;
}

export const WEARABLE_PROVIDERS: Record<WearableProviderId, WearableProviderSpec> = {
  health_connect: {
    id: "health_connect",
    label: "Health Connect",
    subtitle: "Android hub",
    family: "native",
    platforms: ["android"],
    blurb: "Samsung, Google, Fitbit, Garmin, Polar, COROS & more via your phone",
    why: "On Android, every supported watch writes into Health Connect — Vaylo Sports reads workouts, heart rate, distance, steps, sleep and calories only when you tap Sync. Nothing is read in the background.",
    healthConnectBridged: false,
    healthKitBridged: false,
    accent: "from-emerald-500 to-teal-500",
  },
  healthkit: {
    id: "healthkit",
    label: "Apple Health",
    subtitle: "Apple Watch & iPhone",
    family: "native",
    platforms: ["ios"],
    blurb: "Apple Watch, iPhone Workout, any app that writes to HealthKit",
    why: "On iPhone, Apple Watch writes into HealthKit. Vaylo Sports reads workouts, heart rate, distance, steps, sleep and energy only after you grant permission.",
    healthConnectBridged: false,
    healthKitBridged: false,
    accent: "from-zinc-900 to-zinc-700",
  },
  garmin: {
    id: "garmin",
    label: "Garmin",
    subtitle: "Forerunner · Fenix · Venu",
    family: "cloud",
    platforms: ["android", "ios", "web"],
    blurb: "Direct import from Garmin Connect (or via Health Connect bridge)",
    why: "Connect Garmin once; Vaylo Sports imports activities, heart rate, distance and steps when you sync. Revoke any time. Also works bridged through Health Connect on Android without linking.",
    healthConnectBridged: true,
    healthKitBridged: false,
    helpUrl: "https://connect.garmin.com/",
    accent: "from-sky-600 to-cyan-500",
  },
  fitbit: {
    id: "fitbit",
    label: "Fitbit",
    subtitle: "Versa · Sense · Charge",
    family: "cloud",
    platforms: ["android", "ios", "web"],
    blurb: "Direct import from Fitbit (also available via Health Connect)",
    why: "Link Fitbit for workouts, heart rate, steps, sleep and calories. On Android Fitbit also writes into Health Connect as an alternative path.",
    healthConnectBridged: true,
    healthKitBridged: false,
    helpUrl: "https://www.fitbit.com/",
    accent: "from-teal-600 to-emerald-500",
  },
  polar: {
    id: "polar",
    label: "Polar",
    subtitle: "Vantage · Grit · Ignite",
    family: "cloud",
    platforms: ["android", "ios", "web"],
    blurb: "Polar Flow link for training sessions and heart data",
    why: "Polar Flow is the vendor cloud for Polar watches — Vaylo Sports imports training sessions, heart rate and distance via Polar AccessLink. Bridged via Health Connect on Android as well.",
    healthConnectBridged: true,
    healthKitBridged: false,
    helpUrl: "https://flow.polar.com/",
    accent: "from-red-600 to-rose-500",
  },
  coros: {
    id: "coros",
    label: "COROS",
    subtitle: "PACE · VERTIX · APEX",
    family: "cloud",
    platforms: ["android", "ios", "web"],
    blurb: "COROS cloud import for runs, rides and HR",
    why: "COROS writes into Health Connect on Android; direct COROS API import is the cloud alternative for all platforms.",
    healthConnectBridged: true,
    healthKitBridged: false,
    helpUrl: "https://www.coros.com/",
    accent: "from-orange-600 to-amber-500",
  },
  whoop: {
    id: "whoop",
    label: "WHOOP",
    subtitle: "Strain · Sleep · Recovery",
    family: "cloud",
    platforms: ["android", "ios", "web"],
    blurb: "WHOOP workouts, strain, sleep and heart data",
    why: "WHOOP's API provides workouts, daily strain, sleep and heart metrics — Vaylo Sports imports them as normalized sessions and samples.",
    healthConnectBridged: true,
    healthKitBridged: false,
    helpUrl: "https://www.whoop.com/",
    accent: "from-zinc-800 to-neutral-600",
  },
  oura: {
    id: "oura",
    label: "Oura",
    subtitle: "Ring — sleep & readiness",
    family: "cloud",
    platforms: ["android", "ios", "web"],
    blurb: "Oura sleep, readiness, HR and daily activity",
    why: "Oura Ring syncs sleep stages, HRV, resting HR, steps and workouts — Vaylo Sports imports them as normalized samples. Also bridges into Health Connect on Android.",
    healthConnectBridged: true,
    healthKitBridged: true,
    helpUrl: "https://ouraring.com/",
    accent: "from-slate-800 to-slate-600",
  },
  samsung_health: {
    id: "samsung_health",
    label: "Samsung Health",
    subtitle: "Galaxy Watch",
    family: "cloud",
    platforms: ["android", "web"],
    blurb: "Galaxy Watch via Health Connect (recommended) or Samsung Health",
    why: "Galaxy Watch writes directly into Health Connect on Samsung phones — no separate link needed. Cloud Samsung Health link is the fallback.",
    healthConnectBridged: true,
    healthKitBridged: false,
    helpUrl: "https://www.samsung.com/global/galaxy/apps/samsung-health/",
    accent: "from-blue-700 to-indigo-600",
  },
  google_fit: {
    id: "google_fit",
    label: "Google Health",
    subtitle: "Pixel Watch & Wear OS",
    family: "cloud",
    platforms: ["android", "web"],
    blurb: "Pixel Watch / Wear OS via Health Connect",
    why: "Pixel Watch and Wear OS devices write into Health Connect. Vaylo Sports reads from Health Connect on Android — no extra OAuth required.",
    healthConnectBridged: true,
    healthKitBridged: false,
    accent: "from-blue-600 to-sky-500",
  },
  suunto: {
    id: "suunto",
    label: "Suunto",
    subtitle: "Race · Vertical · 9 Peak",
    family: "cloud",
    platforms: ["android", "ios", "web"],
    blurb: "Suunto app workouts and HR via cloud",
    why: "Suunto App syncs workouts and HR to the Suunto cloud; Vaylo Sports can import them directly. Suunto also bridges into Health Connect on Android.",
    healthConnectBridged: true,
    healthKitBridged: false,
    helpUrl: "https://www.suunto.com/",
    accent: "from-amber-700 to-orange-600",
  },
  withings: {
    id: "withings",
    label: "Withings",
    subtitle: "ScanWatch & scales",
    family: "cloud",
    platforms: ["android", "ios", "web"],
    blurb: "Withings Health Mate workouts and vitals",
    why: "Withings ScanWatch and health devices sync through Health Mate; Vaylo Sports imports workouts, heart rate, steps and sleep.",
    healthConnectBridged: true,
    healthKitBridged: true,
    helpUrl: "https://www.withings.com/",
    accent: "from-cyan-700 to-teal-600",
  },
  strava: {
    id: "strava",
    label: "Strava",
    subtitle: "Runs · Rides · Segments",
    family: "cloud",
    platforms: ["android", "ios", "web"],
    blurb: "Most connected fitness network — workouts + segments",
    why: "Strava connects to almost every watch (Garmin, COROS, Polar, Apple, …). Linking Strava imports the same normalized workouts as a convenience hub.",
    healthConnectBridged: false,
    healthKitBridged: false,
    helpUrl: "https://www.strava.com/",
    accent: "from-orange-600 to-red-500",
  },
  huawei: {
    id: "huawei",
    label: "Huawei Health",
    subtitle: "Watch GT · Band",
    family: "cloud",
    platforms: ["android", "web"],
    blurb: "Huawei Watch via Health Connect bridge",
    why: "Huawei Health writes into Health Connect on Android (via Health Sync adapters) — Vaylo Sports reads from Health Connect. Direct Huawei cloud coming next.",
    healthConnectBridged: true,
    healthKitBridged: false,
    accent: "from-red-600 to-red-400",
  },
};

export const WEARABLE_ORDER: WearableProviderId[] = [
  "health_connect",
  "healthkit",
  "garmin",
  "fitbit",
  "polar",
  "coros",
  "whoop",
  "oura",
  "samsung_health",
  "google_fit",
  "suunto",
  "withings",
  "strava",
  "huawei",
];

/** Cloud providers that require an edge-function OAuth secret to be fully live. */
export const CLOUD_PROVIDERS = WEARABLE_ORDER.filter(
  (id) => WEARABLE_PROVIDERS[id].family === "cloud"
) as WearableProviderId[];

/** Native hub providers (on-device). */
export const NATIVE_PROVIDERS = WEARABLE_ORDER.filter(
  (id) => WEARABLE_PROVIDERS[id].family === "native"
) as WearableProviderId[];
