# The downloadable web-app clone — and the rule that keeps it in step with the APK

## What it is

`VayloSports-WebApp.zip` (repo root) is a static, keyless copy of the app —
the **same React source the APK ships** — meant to be attached to AI chatbots
or handed to anyone. It is completely separate from the Vaylo Sports marketing
website (`website/`, `site/`, `scripts/gen-website.cjs`): nothing under those
paths builds, mounts, links or deploys the clone, and the clone never touches
the site.

Unzipped, it lives in `webapp-clone/` (regenerated on every build, safe to
delete). `webapp-clone/README.txt` tells the recipient how to open it and what
is deliberately non-functional.

## How to build it

```bash
npm run build:clone        # → webapp-clone/ + VayloSports-WebApp.zip
```

One command, defined in `scripts/build-clone.cjs`. It runs `build-web.cjs`
with three environment overrides and then **verifies** the output before
zipping — a failed verification exits non-zero and writes no zip:

| Override | Why |
| --- | --- |
| `VITE_DEMO_MODE=true` | turns on the local guest + free purchases (below) |
| `VITE_SUPABASE_URL=https://vaylo-demo.invalid` | no API key; `.invalid` never resolves, so no backend call can leave the machine |
| `VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_demo_clone_placeholder` | ditto, and it beats any `.env` value so a real key cannot be embedded (the `sb_publishable_` prefix is required by `vite.config.ts`) |

The verification asserts: no `*.supabase.co` host and no publishable key in
any emitted file (also checked against the literal values in `.env` if one
exists), the demo seams compiled in, and Apple/iPhone still hidden behind
`isFlagOn("iphone")` exactly as in the APK.

## The demo seams (all behind `DEMO_MODE`)

`DEMO_MODE` is `import.meta.env.VITE_DEMO_MODE === "true"`, which is false in
every other build — the APK, the Play bundle and the standalone web build
compile every branch below away. Tests: `src/lib/demoMode.test.ts`.

1. **`src/lib/demoMode.ts`** — the flag, a stable browser-local guest session
   (anonymous user, far-future local JWT, never sent anywhere), and a
   localStorage store of free grants.
2. **`src/contexts/AuthContext.tsx`** — guest entry mints the local session
   instead of `signInAnonymously()`; profile reads are skipped (the "Guest"
   label renders from the user object).
3. **`src/contexts/SubscriptionContext.tsx`** — entitlements read the local
   grant store instead of the `get_my_entitlements` RPC. **Credits stay at
   zero: balances are non-functional in the clone, by request.**
4. **`src/lib/billing.ts`** — `purchaseItems()` grants locally and returns ok
   without Play Billing, an edge function or a charge: **every purchase is
   free**. It is the single seam all buy buttons already funnel through
   (feature unlocks, credit/coin packs, starter offer, Market).

Everything else (training data, AI, community, sign-in methods, native
plugins) has no backend and fails or renders empty — the clone's README says
so plainly.

## THE SYNC RULE

**Every time the APK is updated, rebuild and re-share the web app too.**

Concretely, after any of these: source changes shipped with
`npm run cap:sync` / `npm run cap:apk`, a new `app-debug.apk`, or any edit to
`src/` that is meant to be visible in the app —

1. build the APK as usual (`npm run cap:apk`);
2. run `npm run build:clone`;
3. hand over the fresh `VayloSports-WebApp.zip`.

The script re-verifies everything each time, so a green run means the zip
matches the APK's source at that moment. Do not ship one without the other:
the whole point of the clone is that it never lags behind the APK.

## Deliberate non-goals

- It is not deployed anywhere — it is a file, not a site. It must never be
  mounted into, linked from, or deployed alongside the marketing website.
- No backend, ever, for this artifact: adding a key would break the promise
  the verification enforces.
- Native plugins stay in the source (the APK needs them); on the web they are
  inert and the clone does not stub them.
