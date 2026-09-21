import { describe, expect, it } from "vitest";

import { enabledSocialProviders } from "./use-auth-providers";

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
  });

  it("does not offer a provider that is merely present or truthy-ish", () => {
    // GoTrue sets `anonymous_users: false` and can add providers we don't support.
    expect(enabledSocialProviders({ anonymous_users: false, github: true })).toEqual([]);
    expect(enabledSocialProviders({ google: "true" as unknown as boolean })).toEqual([]);
  });
});
