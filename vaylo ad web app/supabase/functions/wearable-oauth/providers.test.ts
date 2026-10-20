// ============================================================================
// wearable-oauth providers — unit tests for the pure module
// ---------------------------------------------------------------------------
// Why these are real unit tests and not source-regex assertions: the authorize
// and token URLs, the credential presentation (Basic header vs form body) and
// the activity mappers are exactly the parts that break silently in production
// — a mapper that emits end_time <= start_time fails the whole batched upsert
// against health_workouts_time_order, and a token request built with the
// credential presentation a vendor does not accept fails only for the athletes
// who try to connect. Both are decidable offline, so both are asserted here
// rather than waited on at runtime.
// ============================================================================

import { describe, expect, it } from "vitest";

import {
  ACTIVITY_MAPPERS,
  IMPORTABLE_PROVIDERS,
  OAUTH_PROVIDERS,
  buildAuthUrl,
  fitbitRow,
  ouraRow,
  parseTokenResponse,
  stravaRow,
  tokenRequest,
} from "./providers";

const CREDS = { clientId: "cid", clientSecret: "sek" };
const REDIRECT = "https://example.supabase.co/functions/v1/wearable-oauth";

describe("provider catalog", () => {
  it("covers exactly the eight vendors the authorize side can serve", () => {
    expect(Object.keys(OAUTH_PROVIDERS).sort()).toEqual(
      ["coros", "fitbit", "garmin", "oura", "polar", "strava", "suunto", "whoop"].sort(),
    );
  });

  it("keeps importable providers a strict subset with a mapper each", () => {
    for (const p of IMPORTABLE_PROVIDERS) {
      expect(OAUTH_PROVIDERS[p], `${p} importable but has no oauth config`).toBeTruthy();
      expect(ACTIVITY_MAPPERS[p], `${p} importable but has no mapper`).toBeTypeOf("function");
    }
  });

  it("has no mapper for a provider that cannot be imported (honest sync note)", () => {
    for (const p of Object.keys(OAUTH_PROVIDERS)) {
      if (!IMPORTABLE_PROVIDERS.has(p)) expect(ACTIVITY_MAPPERS[p]).toBeUndefined();
    }
  });
});

describe("buildAuthUrl", () => {
  it("builds an authorization-code URL for every provider", () => {
    for (const [provider, cfg] of Object.entries(OAUTH_PROVIDERS)) {
      const url = buildAuthUrl(provider, "cid", REDIRECT, "st4te");
      expect(url, provider).toBeTruthy();
      expect(url!.startsWith(`${cfg.authorizeUrl}?`)).toBe(true);
      const params = new URL(url!).searchParams;
      expect(params.get("response_type")).toBe("code");
      expect(params.get("client_id")).toBe("cid");
      expect(params.get("redirect_uri")).toBe(REDIRECT);
      expect(params.get("state")).toBe("st4te");
      // Scope is sent only where the vendor's flow documents one.
      if (cfg.scope) expect(params.get("scope")).toBe(cfg.scope);
      else expect(params.has("scope")).toBe(false);
    }
  });

  it("refuses an unknown provider or a missing client id", () => {
    expect(buildAuthUrl("not-a-vendor", "cid", REDIRECT, "s")).toBeNull();
    expect(buildAuthUrl("strava", "", REDIRECT, "s")).toBeNull();
  });
});

describe("tokenRequest", () => {
  it("presents credentials the way each vendor documents", () => {
    // Fitbit: Basic header, no credentials in the body.
    const fitbit = tokenRequest("fitbit", CREDS, { type: "authorization_code", code: "abc" }, REDIRECT)!;
    expect(fitbit.headers.Authorization).toBe(`Basic ${btoa("cid:sek")}`);
    const fBody = new URLSearchParams(fitbit.body);
    expect(fBody.get("grant_type")).toBe("authorization_code");
    expect(fBody.get("code")).toBe("abc");
    expect(fBody.get("redirect_uri")).toBe(REDIRECT);
    expect(fBody.has("client_secret")).toBe(false);

    // Strava: credentials in the body, no Authorization header.
    const strava = tokenRequest("strava", CREDS, { type: "authorization_code", code: "abc" }, REDIRECT)!;
    expect(strava.headers.Authorization).toBeUndefined();
    const sBody = new URLSearchParams(strava.body);
    expect(sBody.get("client_id")).toBe("cid");
    expect(sBody.get("client_secret")).toBe("sek");
    expect(sBody.get("code")).toBe("abc");
  });

  it("builds the refresh grant without a code or redirect_uri", () => {
    const req = tokenRequest("fitbit", CREDS, { type: "refresh_token", refreshToken: "r1" }, REDIRECT)!;
    const body = new URLSearchParams(req.body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("r1");
    expect(body.has("code")).toBe(false);
    expect(body.has("redirect_uri")).toBe(false);
  });

  it("refuses grants that are missing their payload, and unknown vendors", () => {
    expect(tokenRequest("fitbit", CREDS, { type: "authorization_code" }, REDIRECT)).toBeNull();
    expect(tokenRequest("fitbit", CREDS, { type: "refresh_token" }, REDIRECT)).toBeNull();
    expect(tokenRequest("nope", CREDS, { type: "authorization_code", code: "x" }, REDIRECT)).toBeNull();
  });

  it("uses each provider's own token endpoint", () => {
    for (const [provider, cfg] of Object.entries(OAUTH_PROVIDERS)) {
      const req = tokenRequest(provider, CREDS, { type: "authorization_code", code: "x" }, REDIRECT)!;
      expect(req.url).toBe(cfg.tokenUrl);
    }
  });
});

describe("parseTokenResponse", () => {
  const now = 1_700_000_000_000;

  it("normalises a full vendor response", () => {
    const t = parseTokenResponse(
      { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "activity:read" },
      now,
    );
    expect(t).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: now + 3_600_000,
      scope: "activity:read",
    });
  });

  it("treats missing expiry/refresh as null rather than inventing one", () => {
    const t = parseTokenResponse({ access_token: "at" }, now);
    expect(t!.expiresAt).toBeNull();
    expect(t!.refreshToken).toBeNull();
    expect(t!.scope).toBeNull();
  });

  it("rejects a body with no access token", () => {
    expect(parseTokenResponse({ refresh_token: "rt" }, now)).toBeNull();
    expect(parseTokenResponse({}, now)).toBeNull();
    expect(parseTokenResponse(null, now)).toBeNull();
  });
});

describe("activity mappers", () => {
  /** The DB CHECK: every mapper output must satisfy end > start. */
  const expectValidWindow = (row: { start_time: string; end_time: string; duration_seconds: number }) => {
    expect(Date.parse(row.end_time)).toBeGreaterThan(Date.parse(row.start_time));
    expect(row.duration_seconds).toBeGreaterThan(0);
  };

  it("maps a Strava activity with metres, seconds and nulls for absent metrics", () => {
    const row = stravaRow({
      id: 123456,
      name: "Morning Run",
      type: "Run",
      start_date: "2026-09-30T07:15:00Z",
      elapsed_time: 1800,
      distance: 5200.4,
      calories: 310.2,
      average_heartrate: 148.5,
      max_heartrate: 172,
    });
    expect(row).toMatchObject({
      source_record_id: "123456",
      title: "Morning Run",
      activity_type: "Run",
      duration_seconds: 1800,
      distance_meters: 5200.4,
      active_calories: 310.2,
      heart_rate_avg: 148.5,
      heart_rate_max: 172,
      heart_rate_min: null,
      steps: null,
    });
    expectValidWindow(row!);
    expect(Date.parse(row!.end_time) - Date.parse(row!.start_time)).toBe(1_800_000);
  });

  it("rejects a Strava activity with no id, no start, or a non-positive duration", () => {
    expect(stravaRow({ start_date: "2026-09-30T07:15:00Z", elapsed_time: 10 })).toBeNull();
    expect(stravaRow({ id: 1, elapsed_time: 10 })).toBeNull();
    expect(stravaRow({ id: 1, start_date: "2026-09-30T07:15:00Z", elapsed_time: 0 })).toBeNull();
    expect(stravaRow({ id: 1, start_date: "nonsense", elapsed_time: 10 })).toBeNull();
  });

  it("converts Fitbit kilometres→metres and milliseconds→seconds", () => {
    const row = fitbitRow({
      logId: 998877,
      activityName: "Outdoor Running",
      startDate: "2026-10-01",
      startTime: "06:30:00",
      duration: 1_800_000,
      distance: 1.5,
      calories: 220,
      averageHeartRate: 151,
      steps: 1620,
    });
    expect(row).toMatchObject({
      source_record_id: "998877",
      title: "Outdoor Running",
      activity_type: "Outdoor Running",
      duration_seconds: 1800,
      distance_meters: 1500,
      active_calories: 220,
      heart_rate_avg: 151,
      steps: 1620,
    });
    expectValidWindow(row!);
    // The composed instant is ISO-parseable and 30 minutes long.
    expect(row!.start_time).toMatch(/^\d{4}-\d{2}-\d{2}T06:30:00/);
    expect(Date.parse(row!.end_time) - Date.parse(row!.start_time)).toBe(1_800_000);
  });

  it("rejects a Fitbit entry missing its identity or duration", () => {
    expect(fitbitRow({ startDate: "2026-10-01", startTime: "06:30:00", duration: 1000 })).toBeNull();
    expect(fitbitRow({ logId: 1, startTime: "06:30:00", duration: 1000 })).toBeNull();
    expect(fitbitRow({ logId: 1, startDate: "2026-10-01", duration: 1000 })).toBeNull();
    expect(fitbitRow({ logId: 1, startDate: "2026-10-01", startTime: "06:30:00", duration: 0 })).toBeNull();
  });

  it("maps an Oura workout from its datetime window", () => {
    const row = ouraRow({
      id: "abc-123",
      start_datetime: "2026-10-02T05:00:00+00:00",
      end_datetime: "2026-10-02T05:45:00+00:00",
      activity_type: "running",
      distance: 8000,
    });
    expect(row).toMatchObject({
      source_record_id: "abc-123",
      activity_type: "running",
      duration_seconds: 2700,
      distance_meters: 8000,
      heart_rate_avg: null,
    });
    expectValidWindow(row!);
    expect(ouraRow({ id: "x", start_datetime: "2026-10-02T06:00:00Z", end_datetime: "2026-10-02T05:00:00Z" })).toBeNull();
    expect(ouraRow({ start_datetime: "2026-10-02T06:00:00Z", end_datetime: "2026-10-02T07:00:00Z" })).toBeNull();
  });

  it("dispatches through ACTIVITY_MAPPERS with each vendor's envelope", () => {
    const strava = ACTIVITY_MAPPERS.strava([
      { id: 1, start_date: "2026-10-01T06:00:00Z", elapsed_time: 600 },
      { id: 2 }, // dropped: no start
    ]);
    expect(strava).toHaveLength(1);
    expectValidWindow(strava[0]);

    const fitbit = ACTIVITY_MAPPERS.fitbit({
      activities: [
        { logId: 9, startDate: "2026-10-01", startTime: "06:00:00", duration: 600_000 },
      ],
    });
    expect(fitbit).toHaveLength(1);
    expectValidWindow(fitbit[0]);

    const oura = ACTIVITY_MAPPERS.oura({
      data: [{ id: "w1", start_datetime: "2026-10-01T06:00:00Z", end_datetime: "2026-10-01T06:10:00Z" }],
    });
    expect(oura).toHaveLength(1);
    expectValidWindow(oura[0]);
  });

  it("treats a wrong-shaped payload as empty, never as an error", () => {
    expect(ACTIVITY_MAPPERS.strava({ not: "an array" })).toEqual([]);
    expect(ACTIVITY_MAPPERS.fitbit(null)).toEqual([]);
    expect(ACTIVITY_MAPPERS.oura(undefined)).toEqual([]);
  });
});
