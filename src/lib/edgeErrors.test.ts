import { describe, expect, it } from "vitest";
import { AI_NOT_READY_MESSAGE, edgeErrorMessage, isNotReadyMessage } from "@/lib/edgeErrors";

/**
 * The seven AI endpoints answer 500 with the name of the missing environment
 * variable until a provider key is set. These are the exact strings they
 * return, so the recogniser is pinned against what the server really says.
 */
const CONFIG_ERRORS = [
  "API key not configured",
  "AI service is not configured",
  "OPENAI_API_KEY not configured",
  "OPENAI_API_KEY missing",
  "Video analysis is not configured.",
];

describe("isNotReadyMessage", () => {
  it.each(CONFIG_ERRORS)("recognises %j as a feature that is not on yet", (message) => {
    expect(isNotReadyMessage(message)).toBe(true);
  });

  it("leaves ordinary failures alone", () => {
    expect(isNotReadyMessage("Not enough credits (need 54).")).toBe(false);
    expect(isNotReadyMessage("Too many AI requests. Wait a moment and try again.")).toBe(false);
    expect(isNotReadyMessage("Unauthorized")).toBe(false);
  });
});

describe("edgeErrorMessage", () => {
  it("replaces a config error read from the response body", async () => {
    const error = {
      context: { json: async () => ({ error: "OPENAI_API_KEY not configured" }) },
    };
    expect(await edgeErrorMessage(error)).toBe(AI_NOT_READY_MESSAGE);
  });

  it("replaces a config error carried on the message", async () => {
    expect(await edgeErrorMessage(new Error("AI service is not configured"))).toBe(AI_NOT_READY_MESSAGE);
  });

  it("never lets a provider key name through to the athlete", async () => {
    for (const message of CONFIG_ERRORS) {
      const shown = await edgeErrorMessage(new Error(message));
      expect(shown).toBe(AI_NOT_READY_MESSAGE);
      expect(shown).not.toMatch(/OPENAI_API_KEY|GOOGLE_API|API key/);
    }
  });

  it("still surfaces a real server reason to the athlete", async () => {
    expect(await edgeErrorMessage(new Error("Not enough credits for form_analysis (need 54)."))).toBe(
      "Not enough credits for form_analysis (need 54).",
    );
  });
});
