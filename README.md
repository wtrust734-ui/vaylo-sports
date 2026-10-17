# Vaylo Sports

Public source for the Vaylo sports app / ad platform checkout.

This repo is the working tree behind the current local build. It is not an official
release artifact — APKs, bundles, and dist outputs are intentionally excluded via
.gitignore and should be published through the project release pipeline instead.

## Local setup

```bash
npm install
```

Requires Node >= 22.

## Scripts

- `npm run build` — app build
- `npm run typecheck` — app + functions typecheck
- `npm run test` — Vitest suite
- `npm run lint` — ESLint

## Supabase functions

Supabase Edge functions live under `supabase/functions/`. Migrations live under
`supabase/migrations/`. Do not commit secrets; use environment injection at deploy time.

