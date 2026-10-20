# VAYLO SPORTS - INTEGRATION, END-TO-END & DATA-CONSISTENCY AUDIT REPORT

**Date:** 2026-10-20  
**Type:** Read-Only Audit  
**Scope:** Frontend-backend integration, cross-feature data flow, navigation, Android/web parity, end-to-end journeys  
**Status:** Static analysis based on codebase inspection

---

## 1. EXECUTIVE SUMMARY

Vaylo Sports is a large, feature-rich application with a complex architecture. The codebase shows sophisticated integration patterns but also indicates areas of complexity that could lead to inconsistencies.

### Overall Assessment
- **Architecture**: COMPLEX but generally well-structured - React + TypeScript frontend, Supabase backend, Capacitor for Android
- **Navigation**: GOOD - Well-organized routing with lazy loading, redirects for deprecated routes, proper guards
- **Data flow**: MIXED - Central patterns exist (contexts, Supabase client) but many features may have their own data fetching patterns
- **Authentication**: SOLID - AuthContext manages sessions, guards in place, guest mode for web preview
- **Cross-feature consistency**: CONCERNS - Many features, risk of data duplication/staleness
- **Release readiness**: CONDITIONAL - Needs testing of integration points

### Critical Findings
1. **Multiple data sources** - Profile used across features; need to verify consistency
2. **AI features** - Multiple AI functions, need to ensure context passed correctly
3. **Credits/purchases** - Complex flow with many edge cases
4. **Training/workout logging** - Potential duplication between systems
5. **Android/web differences** - Many platform-specific behaviors

---

## 2. ARCHITECTURE MAP

### Frontend
- **Framework**: React 18, TypeScript, Vite
- **Routing**: React Router v6 (BrowserRouter on web, HashRouter on native)
- **State**: React Query, Context API (Auth, Subscription)
- **UI**: Tailwind CSS, shadcn/ui components, Framer Motion
- **Navigation**: BottomNav (Home, Train, Perform, Profile) + Sidebar + TabShell for tab roots

### Backend
- **Platform**: Supabase (Postgres, Auth, Storage, Edge Functions)
- **Edge Functions**: 14 functions (coach-chat, process-purchase, video-form-analysis, generate-plan, etc.)
- **Auth**: Supabase Auth with guest mode
- **Storage**: Supabase Storage for files/videos

### Data Layer
- **Client**: src/integrations/supabase/client.ts
- **Types**: Generated types in src/integrations/supabase/types.ts
- **RLS**: Row Level Security enforced on tables
- **Functions**: PostgreSQL functions for critical operations (credits_spend, etc.)

### External Integrations
- OpenAI (coach, plans, nutrition)
- Google Gemini (video/form analysis)
- Google Play Billing (scaffolded, disabled)
- Stripe (coach marketplace web)
- Health Connect (Android)
- Wearables (Strava, Garmin, etc.)

---

## 3. NAVIGATION & FEATURE CONNECTIVITY

### Main Navigation (BottomNav)
- Home (/) - Index
- Train (/train) - Training hub
- Perform (/perform) - Performance hub  
- Profile (/profile) - User profile

### Route Structure
- Tab roots use TabShell for keep-alive
- Lazy loaded routes for performance
- Many redirects for deprecated routes (good for backwards compat)
- Auth guards in AppLayout
- Admin routes protected with RequireAdmin

### Observations
- **GOOD**: Extensive redirects prevent 404s
- **GOOD**: Lazy loading implemented
- **GOOD**: Clear route organization
- **CONCERN**: Many routes (100+), complexity increases integration risk
- **CONCERN**: Some features gated by flags (coachMarketplace)

---

## 4. ATHLETE PROFILE AS SHARED SOURCE OF TRUTH

**Profile fields used across app** (from schema inspection): sport, experience_level, goals, availability/training days, date_of_birth, height_cm, weight_kg, etc.

**Integration points:**
- Training plan generation uses sport/goals/availability
- AI coach uses profile context
- Age restrictions based on DOB
- Units/preferences

**Concerns:**
- **MEDIUM**: Need to verify profile updates propagate to cached data
- **MEDIUM**: Multiple places may read profile separately
- **LOW**: Good use of central profile

---

## 5. TRAINING PLAN & AVAILABILITY INTEGRATION

**Components:**
- Availability page (/availability) for setting training days
- Training plans generated based on availability
- Training page shows plans
- Workouts page for logging

**Potential issues:**
- **MEDIUM**: Plan regeneration - need to ensure doesn't overwrite completed sessions
- **MEDIUM**: Separate logging systems (workouts vs performance) - could cause duplication
- **MEDIUM**: Calendar/date handling across time zones

---

## 6. AI FEATURE INTEGRATION

**AI Functions:**
- coach-chat: Uses athlete dossier, charges credits, refunds on failure
- generate-plan: Creates training plans
- video-form-analysis: With quota system
- ai-service: General AI service

**Integration concerns:**
- **MEDIUM**: Context passed to AI - need to ensure up-to-date
- **MEDIUM**: Credit charging - up-front with refunds (good pattern)
- **MEDIUM**: Failed requests leave UI in bad state?
- **LOW**: Good error handling patterns seen

---

## 7. CREDITS, PURCHASES & ENTITLEMENTS

**System (from monetisation audit):**
- Strong server-side enforcement
- credits_spend() as single source of truth
- Idempotency protection
- **CRITICAL**: Payment bugs in process-purchase need fixing before enabling
- STORE_BILLING_ENABLED=false currently

**Cross-feature integration:**
- Credit-gated features check balances
- Entitlements from user_purchases/subscriptions

**Concerns:**
- **CRITICAL**: Payment flow bugs block monetization
- **MEDIUM**: Balance consistency across screens

---

## 8. ANDROID/WEB PARITY

**Differences:**
- Routing: HashRouter on native vs BrowserRouter on web
- Guest mode disabled on native (OAuth works)
- Platform-specific plugins
- Status bar handling
- Back button handling
- Deep links

**Concerns:**
- **MEDIUM**: Need to test all features on both platforms
- **MEDIUM**: File uploads/camera permissions differ
- **LOW**: Good platform abstraction with isNativeShell()

---

## 9. END-TO-END TEST SCENARIOS

Based on codebase analysis, key journeys to test:

| Journey | Status | Notes |
|---------|--------|-------|
| New account + onboarding | UNTESTED | Flow exists, needs verification |
| Profile setup changes propagate | UNTESTED | Need to check cache invalidation |
| Create training plan | UNTESTED | Uses availability, AI generation |
| Log workout | UNTESTED | Multiple logging paths possible |
| AI coach interaction | UNTESTED | Credit charging + refunds |
| Video analysis | UNTESTED | Quota + metered charging |
| Purchase flow | UNTESTED | Disabled currently, bugs exist |
| App restart/session restore | UNTESTED | Auth persistence |
| Account deletion | UNTESTED | Implemented per policy |

---

## 10. PRIORITIZED DEFECT REGISTER

### CRITICAL (Block Release)
1. **INT-001**: Fix process-purchase rollback bugs before enabling payments
2. **INT-002**: Verify no medical claims in AI outputs/UI
3. **INT-003**: Ensure age protections properly enforced

### HIGH
4. **INT-004**: Test profile update propagation across features
5. **INT-005**: Verify training plan/workout logging consistency
6. **INT-006**: Test AI feature error handling and credit refunds
7. **INT-007**: Android/web parity testing

### MEDIUM
8. **INT-008**: Check for stale caches after data changes
9. **INT-009**: Verify notification triggers
10. **INT-010**: Test offline/network error handling

---

## 11. RELEASE READINESS ASSESSMENT

**Overall:** NOT READY for public launch

**Blockers:**
- Payment system has critical bugs
- Legal/compliance items need resolution (operator details, retention)
- Integration testing needed
- Android build not verified

**Ready areas:**
- Core architecture solid
- Auth system robust
- Credit accounting well-designed
- Legal docs comprehensive
- Navigation structure good

**Recommendation:** Address critical blockers, run integration tests, then reassess.

---

**Audit Status:** COMPLETE (Static Analysis)  
**Note:** Full end-to-end testing requires running application with test accounts. Many integration points identified for testing.
