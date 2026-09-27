import { describe, expect, it } from "vitest";

import { enabledSocialProviders, parseAuthMethods, passkeySupported, normalisePhone } from "./use-auth-providers";

describe("enabledSocialProviders", () => {
  it("reports nothing when the settings payload is missing", () => {
    expect(enabledSocialProviders(undefined)).toEqual([]);
    expect(enabledSocialProviders(null)).toEqual([]);
    expect(enabledSocialProviders({})).toEqual([]);
  });

  it("keeps only providers GoTrue reports as enabled", () => {
    expect(enabledSocialProviders({ google: true, apple: true })).toEqual(["google", "apple"]);
    expect(enabledSocialProviders({ google: true, apple: false })).toEqual(["google"]);
    expect(enabledSocialProviders({ google: false, apple: true })).toEqual(["apple"]);
    expect(enabledSocialProviders({ google: false, apple: false })).toEqual([]);
    expect(enabledSocialProviders({ azure: true })).toEqual(["azure"]);
    expect(enabledSocialProviders({ google: true, apple: true, azure: true })).toEqual([
      "google",
      "apple",
      "azure",
    ]);
  });

  it("does not offer a provider that is merely present or truthy-ish", () => {
    // GoTrue sets `anonymous_users: false` and can add providers we don't support.
    expect(enabledSocialProviders({ anonymous_users: false, github: true })).toEqual([]);
    expect(enabledSocialProviders({ google: "true" as unknown as boolean })).toEqual([]);
  });
});

describe("parseAuthMethods", () => {
  it("reads the live project shape: email + passkeys on, OAuth/phone off", () => {
    const methods = parseAuthMethods({
      external: { email: true, google: false, apple: false, phone: false },
      passkeys_enabled: true,
    });
    expect(methods).toEqual({ providers: [], passkeys: true, email: true, phone: false });
  });

  it("reports OAuth providers and phone only when enabled", () => {
    const methods = parseAuthMethods({
      external: { email: true, google: true, apple: false, azure: true, phone: true },
      passkeys_enabled: false,
    });
    expect(methods.providers).toEqual(["google", "azure"]);
    expect(methods.passkeys).toBe(false);
    expect(methods.phone).toBe(true);
  });

  it("degrades to password-only on garbage payloads", () => {
    expect(parseAuthMethods(null)).toEqual({ providers: [], passkeys: false, email: false, phone: false });
    expect(parseAuthMethods("oops")).toEqual({ providers: [], passkeys: false, email: false, phone: false });
    expect(parseAuthMethods({})).toEqual({ providers: [], passkeys: false, email: false, phone: false });
  });
});

describe("normalisePhone", () => {
  it("accepts E.164 with readable separators", () => {
    expect(normalisePhone("+44 7700 900123")).toBe("+447700900123");
    expect(normalisePhone("+1 (555) 010-1234")).toBe("+15550101234");
    expect(normalisePhone("+919876543210")).toBe("+919876543210");
  });

  it("rejects numbers without a country code or with bad shapes", () => {
    expect(normalisePhone("07700900123")).toBeNull();
    expect(normalisePhone("+44")).toBeNull();
    expect(normalisePhone("+0 1234567")).toBeNull();
    expect(normalisePhone("+4412345678901234567")).toBeNull();
    expect(normalisePhone("")).toBeNull();
  });
});

describe("passkeySupported", () => {
  it("returns a boolean and never throws", () => {
    expect(typeof passkeySupported()).toBe("boolean");
  });
});
