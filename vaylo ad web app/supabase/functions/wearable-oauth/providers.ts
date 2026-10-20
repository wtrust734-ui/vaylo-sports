// ===========================================================================
// wearable-oauth — provider catalog, token requests, and activity mappers
// ---------------------------------------------------------------------------
// Pure module: no Deno APIs, no fetch, no secrets. index.ts does the I/O and
// holds every credential read; this file holds everything that is *decidable
// without a network* so it can be unit-tested on Node (providers.test.ts) the
// same way legal/route.ts is.
//
// Three responsibilities:
//   1. buildAuthUrl  — the vendor authorize URL (was inline in index.ts)
//   2. tokenRequest / parseTokenResponse — the code→token exchange and the
//      refresh grant, both form-encoded, with each vendor's own credential
//      presentation ("basic" = Authorization header, "body" = form fields)
//   3. activity mappers — vendor payload → health_workouts row. The mappers
//      are TOTAL for the fields the DB constrains: every row they return has
//      end_time > start_time (the table CHECKs it), a stable source_record_id
//      (the table UNIQUEs it), and null — never a fabricated number — for any
//      metric the vendor did not supply.
// ===========================================================================

export interface ProviderOAuth {
  /** Vendor authorize endpoint (authorization-code flow, response_type=code). */
  authorizeUrl: string;
  /** Vendor token endpoint — used for both the code exchange and refresh. */
  tokenUrl: string;
  /** How client credentials travel: Basic header or form-body fields. */
  tokenAuth: "basic" | "body";
  /** Space-separated scopes; empty string means "send no scope param". */
  scope: string;
  /**
   * Whether the token exchange echoes redirect_uri. RFC 6749 requires it for
   * authorization_code when it was present in the authorize request — and it
   * was, because buildAuthUrl always sends it — so this stays true unless a
   * vendor documents otherwise.
   */
  sendRedirectUri: boolean;
}

/**
 * The eight vendors the authorize side can build a URL for. The other six
 * entries in the app's wearable catalog (samsung_health, google_fit, huawei,
 * withings, healthkit, health_connect) are on-device hubs or Health Connect
 * bridges and never hit this table — they are absent by design, not missing.
 */
export const OAUTH_PROVIDERS: Record<string, ProviderOAuth> = {
  garmin: {
    authorizeUrl: "https://connect.garmin.com/oauthConfirm",
    tokenUrl: "https://connect.garmin.com/gc-oauth2/token",
    tokenAuth: "basic",
    scope: "activity:read",
    sendRedirectUri: true,
  },
  fitbit: {
    authorizeUrl: "https://www.fitbit.com/oauth2/authorize",
    tokenUrl: "https://api.fitbit.com/oauth2/token",
    tokenAuth: "basic",
    scope: "activity heartrate sleep profile",
    sendRedirectUri: true,
  },
  polar: {
    authorizeUrl: "https://flow.polar.com/oauth2/authorization",
    tokenUrl: "https://api.polar.com/v2/oauth2/token",
    tokenAuth: "basic",
    scope: "",
    sendRedirectUri: true,
  },
  oura: {
    authorizeUrl: "https://cloud.ouraring.com/oauth/authorize",
    tokenUrl: "https://api.ouraring.com/oauth/token",
    tokenAuth: "body",
    scope: "email personal daily workout tag session",
    sendRedirectUri: true,
  },
  strava: {
    authorizeUrl: "https://www.strava.com/oauth/authorize",
    tokenUrl: "https://www.strava.com/oauth/token",
    tokenAuth: "body",
    scope: "activity:read_all",
    sendRedirectUri: true,
  },
  whoop: {
    authorizeUrl: "https://api.prod.whoop.com/oauth/oauth2/auth",
    tokenUrl: "https://api.prod.whoop.com/oauth/oauth2/token",
    tokenAuth: "basic",
    scope: "read:recovery read:cycles read:workout read:sleep read:profile",
    sendRedirectUri: true,
  },
  coros: {
    authorizeUrl: "https://team.coros.com/oauth2/authorize",
    tokenUrl: "https://team.coros.com/oauth2/token",
    tokenAuth: "body",
    scope: "activity",
    sendRedirectUri: true,
  },
  suunto: {
    authorizeUrl: "https://cloudapi-oauth.suunto.com/oauth/authorize",
    tokenUrl: "https://cloudapi-oauth.suunto.com/oauth/token",
    tokenAuth: "basic",
    scope: "",
    sendRedirectUri: true,
  },
};

/**
 * Providers whose ACTIVITY IMPORT is implemented (token exchange alone only
 * makes the row say "connected"; without an importer the sync reports
 * `import_not_implemented` rather than pretending). Adding a vendor here is a
 * mapper + one fetch shape in index.ts — never a silent zero-row "success".
 */
export const IMPORTABLE_PROVIDERS = new Set(["strava", "fitbit", "oura"]);

// ---------------------------------------------------------------------------
// 1. Authorize URL
// ---------------------------------------------------------------------------

/** The vendor authorize URL, or null for a provider this app cannot serve. */
export function buildAuthUrl(
  provider: string,
  clientId: string,
  redirectUri: string,
  state: string,
): string | null {
  const cfg = OAUTH_PROVIDERS[provider];
  if (!cfg || !clientId) return null;
  const p = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  if (cfg.scope) p.set("scope", cfg.scope);
  return `${cfg.authorizeUrl}?${p.toString()}`;
}

// ---------------------------------------------------------------------------
// 2. Token exchange / refresh
// ---------------------------------------------------------------------------

export interface TokenGrant {
  type: "authorization_code" | "refresh_token";
  code?: string;
  refreshToken?: string;
}

export interface TokenRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * A form-encoded token request for either grant. Client secrets go wherever
 * the vendor documents (Basic header vs body) — that is what tokenAuth
 * decides — and the secret appears only in the returned headers/body, never
 * in anything loggable by the caller.
 */
export function tokenRequest(
  provider: string,
  creds: { clientId: string; clientSecret: string },
  grant: TokenGrant,
  redirectUri: string,
): TokenRequest | null {
  const cfg = OAUTH_PROVIDERS[provider];
  if (!cfg) return null;
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  const body = new URLSearchParams({ grant_type: grant.type });
  if (cfg.tokenAuth === "basic") {
    headers["Authorization"] =
      `Basic ${btoa(`${creds.clientId}:${creds.clientSecret}`)}`;
  } else {
    body.set("client_id", creds.clientId);
    body.set("client_secret", creds.clientSecret);
  }
  if (grant.type === "authorization_code") {
    if (!grant.code) return null;
    body.set("code", grant.code);
    if (cfg.sendRedirectUri && redirectUri) body.set("redirect_uri", redirectUri);
  } else {
    if (!grant.refreshToken) return null;
    body.set("refresh_token", grant.refreshToken);
  }
  return { url: cfg.tokenUrl, headers, body: body.toString() };
}

export interface ParsedToken {
  accessToken: string;
  /** Null when the vendor issued none — then there is nothing to refresh. */
  refreshToken: string | null;
  /** Epoch ms of expiry, or null when the vendor issued no expires_in. */
  expiresAt: number | null;
  scope: string | null;
}

/** Normalises a vendor token response. Returns null on a malformed body. */
export function parseTokenResponse(payload: unknown, nowMs: number): ParsedToken | null {
  const p = payload as {
    access_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
    scope?: unknown;
  };
  if (typeof p?.access_token !== "string" || !p.access_token) return null;
  const expiresIn = Number(p.expires_in);
  return {
    accessToken: p.access_token,
    refreshToken: typeof p.refresh_token === "string" && p.refresh_token ? p.refresh_token : null,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? nowMs + expiresIn * 1000 : null,
    scope: typeof p.scope === "string" ? p.scope : null,
  };
}

// ---------------------------------------------------------------------------
// 3. Activity mappers — vendor payload → health_workouts row
// ---------------------------------------------------------------------------

/** The columns this app owns on health_workouts (user_id/source added by caller). */
export interface WorkoutRow {
  source_record_id: string;
  title: string | null;
  activity_type: string;
  start_time: string;
  end_time: string;
  duration_seconds: number;
  distance_meters: number | null;
  active_calories: number | null;
  heart_rate_avg: number | null;
  heart_rate_max: number | null;
  heart_rate_min: number | null;
  steps: number | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Shared guard: parse a start/end pair and reject anything that would violate
 * health_workouts_time_order (end > start). A mapper returning a bad row would
 * fail the whole batched upsert, so one malformed record must never reach it.
 */
function window(
  start: Date | null,
  end: Date | null,
): { startMs: number; endMs: number } | null {
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end.getTime() <= start.getTime()) return null;
  return { startMs: start.getTime(), endMs: end.getTime() };
}

// --- Strava -----------------------------------------------------------------
// GET https://www.strava.com/api/v3/athlete/activities?after=<epoch>&per_page=50
// ISO timestamps with offsets, distance in metres, elapsed_time in seconds,
// calories in kcal, heartrate nullable. All units already match the schema.

export function stravaRow(a: unknown): WorkoutRow | null {
  const act = a as {
    id?: unknown; name?: unknown; type?: unknown; sport_type?: unknown;
    start_date?: unknown; elapsed_time?: unknown; distance?: unknown;
    calories?: unknown; average_heartrate?: unknown; max_heartrate?: unknown;
  };
  if (act?.id == null || typeof act.start_date !== "string") return null;
  const dur = Number(act.elapsed_time);
  if (!Number.isFinite(dur) || dur <= 0) return null;
  const start = new Date(act.start_date);
  const w = window(start, new Date(start.getTime() + dur * 1000));
  if (!w) return null;
  return {
    source_record_id: String(act.id),
    title: typeof act.name === "string" ? act.name : null,
    activity_type: String(act.type ?? act.sport_type ?? "workout"),
    start_time: new Date(w.startMs).toISOString(),
    end_time: new Date(w.endMs).toISOString(),
    duration_seconds: Math.round(dur),
    distance_meters: num(act.distance),
    active_calories: num(act.calories),
    heart_rate_avg: num(act.average_heartrate),
    heart_rate_max: num(act.max_heartrate),
    heart_rate_min: null,
    steps: null,
  };
}

// --- Fitbit -----------------------------------------------------------------
// GET https://api.fitbit.com/1/user/-/activities/list.json
//     ?afterDate=YYYY-MM-DD&sort=asc&offset=0&limit=100
// distance is KILOMETRES (converted here), duration is MILLISECONDS, and the
// times are wall-clock in the athlete's local zone with no offset. Interpreted
// as UTC: the duration and the dedup id are exact, the clock time can be off by
// the user's UTC offset. Nothing is invented to paper over that — the row is
// what Fitbit actually sent.

export function fitbitRow(a: unknown): WorkoutRow | null {
  const act = a as {
    logId?: unknown; activityName?: unknown; startDate?: unknown;
    startTime?: unknown; duration?: unknown; distance?: unknown;
    calories?: unknown; averageHeartRate?: unknown; steps?: unknown;
  };
  if (act?.logId == null || typeof act.startDate !== "string" || typeof act.startTime !== "string") {
    return null;
  }
  const durMs = Number(act.duration);
  if (!Number.isFinite(durMs) || durMs <= 0) return null;
  // startDate "yyyy-MM-dd" + startTime "HH:mm:ss" → ISO instant (see note above).
  const start = new Date(`${act.startDate}T${act.startTime}Z`);
  const w = window(start, new Date(start.getTime() + durMs));
  if (!w) return null;
  const km = num(act.distance);
  const name = typeof act.activityName === "string" ? act.activityName : null;
  return {
    source_record_id: String(act.logId),
    title: name,
    activity_type: name ?? "workout",
    start_time: new Date(w.startMs).toISOString(),
    end_time: new Date(w.endMs).toISOString(),
    duration_seconds: Math.round(durMs / 1000),
    distance_meters: km == null ? null : Math.round(km * 1000),
    active_calories: num(act.calories),
    heart_rate_avg: num(act.averageHeartRate),
    heart_rate_max: null,
    heart_rate_min: null,
    steps: num(act.steps),
  };
}

// --- Oura -------------------------------------------------------------------
// GET https://api.ouraring.com/v2/usercollection/workout?start_date=YYYY-MM-DD
// ISO datetimes with offsets; distance in metres per the v2 docs; no heart
// rate or calorie fields on the workout summary, so those stay null.

export function ouraRow(a: unknown): WorkoutRow | null {
  const w = a as {
    id?: unknown; start_datetime?: unknown; end_datetime?: unknown;
    activity_type?: unknown; distance?: unknown; calories?: unknown;
  };
  if (w?.id == null || typeof w.start_datetime !== "string" || typeof w.end_datetime !== "string") {
    return null;
  }
  const win = window(new Date(w.start_datetime), new Date(w.end_datetime));
  if (!win) return null;
  return {
    source_record_id: String(w.id),
    title: typeof w.activity_type === "string" ? w.activity_type : null,
    activity_type: typeof w.activity_type === "string" ? w.activity_type : "workout",
    start_time: new Date(win.startMs).toISOString(),
    end_time: new Date(win.endMs).toISOString(),
    duration_seconds: Math.round((win.endMs - win.startMs) / 1000),
    distance_meters: num(w.distance),
    active_calories: num(w.calories),
    heart_rate_avg: null,
    heart_rate_max: null,
    heart_rate_min: null,
    steps: null,
  };
}

/** Mapper per importable provider; undefined = not importable. */
export const ACTIVITY_MAPPERS: Record<string, (payload: unknown) => WorkoutRow[]> = {
  strava: (payload) =>
    (Array.isArray(payload) ? payload : []).map(stravaRow).filter((r): r is WorkoutRow => r !== null),
  fitbit: (payload) => {
    const list = (payload as { activities?: unknown[] })?.activities;
    return (Array.isArray(list) ? list : []).map(fitbitRow).filter((r): r is WorkoutRow => r !== null);
  },
  oura: (payload) => {
    const list = (payload as { data?: unknown[] })?.data;
    return (Array.isArray(list) ? list : []).map(ouraRow).filter((r): r is WorkoutRow => r !== null);
  },
};
