import { describe, expect, it } from "vitest"
import { scanText } from "../../scripts/secret-scan.mjs"

/**
 * These tests exist because the first version of the scanner did not work.
 *
 * It was written, run, and reported PASS on a repository that still contained
 * the reviewer password in five commits — because the rules only matched
 * `password: "..."` and the leak was written as
 * `process.env.UI_PASSWORD || "..."`. A credential scanner with no test
 * asserting it catches the known credential is a scanner whose green run means
 * nothing, which is exactly the failure it was added to prevent.
 *
 * The positive cases below are therefore pinned to the real shape of the real
 * leak, not to an invented one.
 */

const ids = (text: string) => scanText(text).map((h) => h.id)

/**
 * The fixtures below are the *shape* of the leak, never its value.
 *
 * Writing the real password here would have been the worst possible version of
 * this change: it would take a credential that is currently recoverable only
 * from history and put it in the tip of main, where every future clone reads it.
 * The assertion the scanner has to pass is about the line's structure, so the
 * value can be anything of the same form.
 */
const FAKE_PASSWORD = "NotTheRealOne!0000"
const FAKE_EMAIL = "someone.else@example.com"

describe("secret-scan catches the reviewer password that was committed", () => {
  // The shape of scripts/ui-audit.mjs at commit e527b548. The credential is the
  // fallback after `||`, not the assignment after `=`.
  it("flags the env-var fallback the password was actually written as", () => {
    const line = `const PASSWORD = process.env.UI_PASSWORD || "${FAKE_PASSWORD}";`
    expect(ids(line)).toContain("env-fallback-literal")
  })

  it("flags the email literal on the adjacent line of the same file", () => {
    const line = `const EMAIL = process.env.UI_EMAIL || "${FAKE_EMAIL}";`
    expect(ids(line)).toContain("env-fallback-literal")
  })

  it("flags the direct object-literal form too", () => {
    expect(ids(`const cfg = { password: "${FAKE_PASSWORD}" };`)).toContain(
      "hardcoded-password",
    )
  })
})

describe("secret-scan still catches the other credential shapes", () => {
  it("flags a JWT", () => {
    // Header and payload are real (the payload says service_role, because that
    // is the case that matters); the signature is filler.
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghijklmnopqrstuvwxyz012345"
    expect(ids(`const k = "${jwt}"`)).toContain("jwt")
  })

  it("flags a private key with real material after the header", () => {
    const pem = [
      "-----BEGIN PRIVATE KEY-----",
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ==",
      "-----END PRIVATE KEY-----",
    ].join("\n")
    expect(ids(pem)).toContain("private-key")
  })

  it("flags an AWS access key id", () => {
    expect(ids('const id = "AKIAIOSFODNN7EXAMPLE";')).toContain("aws-access-key")
  })

  it("flags an OpenAI key", () => {
    // The example key from OpenAI's own documentation, not a working one.
    expect(ids('const k = "sk-proj-abcdefghij0123456789ABCDEFGHIJ";')).toContain("openai-key")
  })
})

describe("secret-scan does not cry wolf on this repository's real code", () => {
  // Each of these is a real line from this repository, or the real shape of one.
  // A scanner that fires on any of them would be turned off within a day, and a
  // scanner that is turned off catches nothing.

  it("ignores the publishable key, which is designed to be public", () => {
    const line = 'apikey:"sb_publishable_abcdefghijklmnopqrstuvwxyz012345"'
    expect(ids(line)).not.toContain("hardcoded-password")
    expect(ids(line)).not.toContain("env-fallback-literal")
  })

  it("ignores the password placeholder in the audit script's own error message", () => {
    expect(ids('{ "email": "...", "password": "..." }')).not.toContain("hardcoded-password")
  })

  it("ignores the PEM header used as documentation placeholder", () => {
    const doc = 'GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----"'
    expect(ids(doc)).not.toContain("private-key")
  })

  it("ignores an env-var reference as a fallback", () => {
    expect(ids('const TOKEN = process.env.SOMETHING || process.env.OTHER')).not.toContain(
      "env-fallback-literal",
    )
  })

  it("ignores placeholder words as credential values", () => {
    for (const value of ["changeme", "your-api-key", "placeholder", "redacted", "***"]) {
      expect(ids(`const apiKey = getenv("X") || "${value}"`)).not.toContain(
        "env-fallback-literal",
      )
    }
  })

  it("ignores the auth grant_type, which says password without being one", () => {
    expect(ids("await fetchJson(`${SUPA_URL}/auth/v1/token?grant_type=password`)")).toEqual([])
  })

  it("ignores a fallback whose variable is not credential-shaped", () => {
    expect(ids('const LABEL = process.env.LOCALE || "en-GB"')).not.toContain(
      "env-fallback-literal",
    )
  })

  it("ignores an empty-string and whitespace fallback", () => {
    expect(ids('const SECRET = process.env.SECRET || ""')).not.toContain("env-fallback-literal")
  })
})
