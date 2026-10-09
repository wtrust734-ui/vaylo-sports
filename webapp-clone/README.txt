VAYLO SPORTS — WEB APP CLONE
============================
A static, downloadable copy of the Vaylo Sports app (the same source as the
APK), rebuilt by `npm run build:clone`. It is completely separate from the
vaylo sports marketing website.

HOW TO VIEW IT
  This is a web app, so it needs a static file server rather than a double
  click (browsers block module scripts over file://):
    npx http-server .
    python -m http.server 8080
  then open http://localhost:8080 . Any static host works; the included
  _redirects / netlify.toml provide the SPA fallback where they are read.

WHAT WORKS
  - Every screen, route and piece of copy, identical to the APK build
  - A local guest session, created in your browser (nothing is uploaded)
  - Purchases: FREE and granted instantly — no payment, no server
  - Feature unlocks (Mental Gym, Form Analysis, ...) open after you "buy" them

WHAT DOES NOT (no backend by design)
  - All server data: profiles, training history, community, AI features
  - Credits and coins: balances stay at zero — they are non-functional
  - Native-only features: Health Connect, haptics, status bar, store billing
  - Sign-in with Google/Apple/email — there is no auth server to talk to

PRIVACY
  No API keys are embedded in this bundle. Every network URL is a reserved
  placeholder that cannot resolve. Nothing you do in it leaves your machine
  except ordinary page loads of the static files themselves.

REBUILDING
  Source of truth: docs/WEB-CLONE.md. `npm run build:clone` regenerates this
  folder and the zip; do that after every APK update so the two stay in step.
