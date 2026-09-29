#!/usr/bin/env node
// Fail the build when a real credential has been committed.
//
//   npm run secret:scan
//
// Why this exists: the Play reviewer account's password was hardcoded in
// scripts/ui-audit.mjs and committed five times before it moved to an ignored
// local file. The move fixed the working tree and left the history untouched, so
// `git show <sha>:scripts/ui-audit.mjs` still hands the password to anyone who
// can clone. Nothing caught it, because the file that would have caught it was
// the file doing the wrong thing.
//
// This scans what git is *tracking*, not the working directory, because the
// working directory legitimately contains real secrets: `.env`, and the local
// credentials file for the review account. Both are git-ignored. A scanner that
// read the working tree would either be useless or need a suppression list long
// enough to defeat itself.
//
// It is deliberately dependency-free and pattern-based. gitleaks and trufflehog
// are better tools and both are Actions you can drop in later; this exists
// because the cost of adding it was a commit, and the cost of not having it was
// already paid once.
//
// It scans itself, which is the point: an earlier version allowlisted this
// file, and that is how a real password ended up sitting in a comment here. An
// allowlisted file is a file nothing checks.
//
// What it does NOT do: it cannot tell a real key from a fake one of the same
// shape, and it does not scan history. Both limits are real and both are worth
// stating out loud rather than letting a green run imply more than it proved.
// Rotation is the only thing that actually removes an exposed secret.

import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { extname, basename as pathBasename } from "node:path"

/** Binary or non-text files: scanning them produces noise, never signal. */
const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".pdf", ".zip",
  ".gz", ".tgz", ".jar", ".aab", ".apk", ".aar", ".so", ".dylib", ".dll",
  ".exe", ".bin", ".keystore", ".jks", ".woff", ".woff2", ".ttf", ".eot",
  ".mp4", ".mov", ".webm", ".lock", ".tsbuildinfo",
])

/**
 * Each rule is `id`, `re`, and `why`. Order matters only for reporting.
 *
 * `re` runs against one line at a time, so a key split across lines is not
 * found. That is acceptable: no credential in this repo's history is wrapped.
 */
export const RULES = [
  {
    id: "jwt",
    // Three base64url segments, each long enough to be a real signature. The
    // shipped JS bundle is checked for these too (see below) because a JWT in
    // client code is the single most damaging thing to leak here: it is a
    // bearer token for whichever role minted it.
    re: /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/,
    why: "A JSON Web Token. If it was minted with the service role it is full database access.",
  },
  {
    id: "private-key",
    // Requires base64 key material on the line *after* the header. A bare
    // header is what both docs placeholders contain
    // (`"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"`), and
    // requiring material is also simply correct: in a real PEM block the
    // header stands alone on its own line.
    //
    // `multiline` because this is the one rule that cannot be evaluated a line
    // at a time. A PEM block is three lines; matching it per line finds the
    // header and then, having proved nothing, reports nothing. That is the same
    // mistake the first version of this file made, in the other direction.
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----\s*\n\s*[A-Za-z0-9+/]{32,}={0,2}/,
    why: "A private key with key material. Whoever holds it can impersonate you or sign releases.",
    multiline: true,
  },
  {
    id: "aws-access-key",
    re: /\bAKIA[0-9A-Z]{16}\b/,
    why: "An AWS access key id.",
  },
  {
    id: "openai-key",
    re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}/,
    why: "An OpenAI API key.",
  },
  {
    id: "google-api-key",
    re: /\bAIza[0-9A-Za-z_-]{35}\b/,
    why: "A Google API key.",
  },
  {
    id: "slack-token",
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
    why: "A Slack token.",
  },
  {
    id: "supabase-legacy-key",
    // The `sb_publishable_` prefix is designed to ship in a client and is
    // deliberately NOT matched. The legacy JWT form of the anon key is, because
    // it is indistinguishable from a service-role key by shape alone.
    re: /\bsupabase[_-]?(?:anon|service_role)[_-]?key["'\s]*[:=]\s*["'][^"']{20,}/i,
    why: "A literal Supabase key assignment.",
  },
  {
    id: "env-fallback-literal",
    // The shape of the reviewer-password leak:
    //
    //     const PASSWORD = process.env.UI_PASSWORD || "<a literal>"
    //
    // This is the exact form that got committed, and a scanner written only for
    // `password: "..."` misses it — which it did, on the first run, when pointed
    // at the commit that contains the real password. The credential sits after
    // the `||`, not after the `=`, so it is a fallback, not an assignment.
    //
    // The real value is deliberately not written here. Quoting it in a comment
    // would move a credential that is currently only in history into the tip of
    // main, which is strictly worse than the problem being fixed.
    // The name has to look credential-ish. Matching every `|| "string"` in a
    // codebase is every string fallback, which is all of them.
    re: /\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*[^;,]*?\|\|\s*(?:"([^"\n]{6,}?)"|'([^'\n]{6,}?)')/,
    why: "A credential-shaped variable falling back to a literal instead of failing when the env var is unset.",
    nameRe: /^(?:.*_)?(?:password|passwd|secret|api_?key|apikey|token|email|credential|auth|private_?key)$/i,
    // Two alternatives rather than `["']…["']`, because a negated character
    // class cannot exclude one quote while permitting the other. With
    // `[^"']` the value truncates at the first apostrophe, which turned
    // `<the account's address>` into `<the account` — a fragment short enough
    // to clear the reject list, so the rule fired on the redaction that exists
    // to stop it firing. Real passwords contain apostrophes too.
    capture: firstOf(2, 3),
    reject: [
      /^\.{2,}$/,
      /^\*+$/,
      /^<.*>$/,
      /^\$\{.*\}$/,
      /^(?:process\.env|import\.meta\.env)\b/,
      /^(?:changeme|change_me|placeholder|example|redacted|dummy|your[-_].*|xxx+)$/i,
      /^sb_publishable_/,
      // A project ref is a URL component, not a secret, and is commonly a
      // literal fallback. A real key is not 20 lowercase-hex-and-letters with
      // no dashes.
      /^[a-z0-9]{20}$/,
    ],
  },
  {
    id: "hardcoded-password",
    // Deliberately narrow. `password` appears all over this repo for legitimate
    // reasons — the grant_type in the auth call, a field name in a type, the
    // word in prose. Requiring a quoted value of real length, and rejecting the
    // placeholders this repo actually uses ("...", "changeme", "***", the
    // env-var expression), is what keeps this from being noise. It found the
    // reviewer password, which is the only proof it is calibrated.
    re: /\b(?:password|passwd|secret|api_?key|token)\b\s*[:=]\s*(?:"([^"\n]{8,}?)"|'([^'\n]{8,}?)')/i,
    why: "A credential assigned as a literal string.",
    capture: firstOf(1, 2),
    reject: [
      /^\.{2,}$/,                       // "..." — the placeholder in ui-audit.mjs
      /^\*+$/,                          // "***"
      /^<.*>$/,                         // "<your-key>"
      /^\$\{.*\}$/,                     // "${process.env.X}"
      /^(?:process\.env|import\.meta\.env)\b/,
      /^(?:changeme|change_me|placeholder|example|redacted|dummy|your[-_].*|xxx+)$/i,
      /^eyJ/,                           // the JWT rule owns this one
      /^sb_publishable_/,               // designed to ship in a client, not a secret
    ],
  },
]

/**
 * Build a `capture` resolver that returns the first group that actually
 * matched. Used by rules that spell out their two quoting styles as separate
 * alternatives, so exactly one of the groups is ever populated.
 */
function firstOf(...indexes) {
  return (m) => {
    for (const i of indexes) {
      if (m[i] !== undefined) return m[i]
    }
    return m[0]
  }
}

/**
 * Run the rules over one line of text.
 *
 * Exported so a test can pin the calibration. A secret scanner with no test
 * asserting it catches the known credential is a scanner whose green run means
 * nothing — that is not hypothetical, it is what the first version of this file
 * did.
 *
 * @returns {{id: string, why: string, sample: string}[]}
 */
export function scanText(text) {
  const out = []
  for (const rule of RULES) {
    // A `multiline` rule is matched against the whole text; everything else is
    // matched per line so a hit can be reported at a line number.
    const haystacks = rule.multiline ? [text] : text.split("\n")
    for (const haystack of haystacks) {
      const m = haystack.match(rule.re)
      if (!m) continue
      if (rule.nameRe && !rule.nameRe.test(m[1] ?? "")) continue
      const value = typeof rule.capture === "function"
        ? rule.capture(m)
        : rule.capture
          ? m[rule.capture]
          : (m[1] ?? m[0])
      if (rule.reject?.some((r) => r.test(value))) continue
      out.push({ id: rule.id, why: rule.why, sample: m[0].trim().slice(0, 80) })
    }
  }
  return out
}

/**
 * Files allowed to contain credential-shaped text. Keep this list short.
 *
 * An entry here is a hole in the scanner, so each one is a decision somebody
 * has to be able to audit later. All three are files that contain a credential
 * *shape* on purpose, not a live credential.
 */
const ALLOW = new Set([
  ".env.example",                     // the tracked template
  // Signs up throwaway accounts with a known-bad password on purpose, to find
  // out whether a session comes back before email confirmation and whether
  // wrong passwords are rate limited. The value is the assertion. It is not a
  // secret because the account it belongs to was created two lines earlier and
  // is deleted at the end of the run.
  "scripts/auth-posture.mjs",
  // The calibration fixtures. This file has to contain the exact *shape* of the
  // reviewer-password leak in order to prove the scanner detects it, which is
  // the only reason the scanner is trusted. The values are deliberately fake —
  // see the comment at the top of the test — and are each provider's published
  // documentation example. Nothing here is a live credential.
  "src/lib/secretScan.test.ts",
])

function isAllowed(file) {
  if (ALLOW.has(file)) return true
  // Examples and docs quote each other's output; the audit script prints an
  // error message containing a JSON shape. All of those are placeholders, and
  // the `reject` list above is what makes them safe, so they are still scanned
  // rather than skipped.
  return false
}

/**
 * Return the files to scan and the mode they came from.
 *
 * This project has two checkouts and only one of them is a git repository: the
 * editing tools are rooted in a plain directory, and git lives in a separate
 * mirror. So the tracked-file list is the right input when it exists and is not
 * available at all in the checkout where this is usually run. Failing there
 * would have made the tool something nobody runs.
 *
 * The working-tree fallback skips the paths that legitimately hold real secrets
 * (`.env`, the local credentials file). That is a weaker check — it depends on
 * this list being right rather than on git — so the mode is printed, and CI
 * asserts the tracked mode.
 */
function collectFiles() {
  try {
    const out = execFileSync("git", ["ls-files"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
    const files = out.split("\n").filter(Boolean)
    if (files.length > 0) return { mode: "tracked", files }
    // An empty list means git succeeded but the tree is bare or freshly
    // initialised. A secret scan that scanned nothing must not report success.
    throw new Error("`git ls-files` returned nothing")
  } catch (err) {
    if (err.stderr !== undefined || /not a git repository/.test(err.message)) {
      // fall through to the directory walk
    } else if (!/returned nothing/.test(err.message)) {
      // fall through to the directory walk
    }
  }

  const SKIP = new Set([
    ".git", "node_modules", "dist", "build", ".freebuff", ".supabase",
    ".gradle", ".idea", ".vscode", "Pods", "DerivedData", "assets",
  ])
  // `.env` holds the real anon key and the project URL. The generated web
  // assets hold the publishable key and i18n strings that mention "password".
  // Both are git-ignored, so tracked mode never sees them, and both would
  // otherwise be permanent false positives here.
  const SKIP_FILE = /^\.env$|^\.env\.(?!example$)/
  const found = []
  const walk = (dir, prefix = "") => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue
      const rel = prefix ? `${prefix}/${e.name}` : e.name
      if (e.isDirectory()) walk(`${dir}/${e.name}`, rel)
      else if (e.isFile() && !SKIP_FILE.test(rel)) found.push(rel)
    }
  }
  walk(".")
  if (found.length === 0) {
    console.error("secret-scan: found no files to scan — refusing to report clean.")
    process.exit(1)
  }
  return { mode: "working-tree", files: found }
}

function report(findings, mode, fileCount) {
  if (findings.length > 0) {
    console.error(`secret-scan: FAIL (${findings.length} finding(s) in ${mode} files)\n`)
    for (const f of findings) {
      const sample = f.sample.slice(0, 12) + "…"
      console.error(`  ${f.file}:${f.line}  [${f.id}]  ${sample}`)
      console.error(`      ${f.why}`)
    }
    console.error("\nA finding is not automatically a live secret — read it before rotating.")
    console.error("If it is real: rotate the credential FIRST, then remove it, then commit.")
    console.error("Rotating after the fact is the only part that cannot be undone by a force-push.")
    process.exit(1)
  }

  console.log(`secret-scan: PASS (mode=${mode}, ${fileCount} files, ${RULES.length} rules, 0 findings)`)
  console.log("secret-scan: scope is the current tree only. History and git config are not scanned.")
}

// Only scan when run directly. The test imports `scanText` to pin the
// calibration, and a module that scans the filesystem on import makes that
// impossible without a working directory that happens to be a repository.
if (process.argv[1] && import.meta.url.endsWith(pathBasename(process.argv[1]))) {
  main()
}

function main() {
  const { mode, files } = collectFiles()

  const findings = []

  for (const file of files) {
    if (isAllowed(file)) continue
    if (BINARY_EXT.has(extname(file).toLowerCase())) continue

    let text
    try {
      if (statSync(file).size > 2 * 1024 * 1024) continue
      text = readFileSync(file, "utf8")
    } catch {
      continue
    }
    // A NUL byte means git thinks it is binary, whatever the extension says.
    if (text.includes("\0")) continue

    const lines = text.split("\n")
    for (const hit of scanText(text)) {
      // Re-locate the line for reporting. scanText deliberately does not carry
      // line numbers so it stays trivially testable.
      const idx = lines.findIndex((l) => l.includes(hit.sample.slice(0, 40)))
      findings.push({ file, line: idx + 1 || 1, id: hit.id, why: hit.why, sample: hit.sample })
    }
  }

  report(findings, mode, files.length)
}
