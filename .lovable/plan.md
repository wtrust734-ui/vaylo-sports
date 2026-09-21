

# HRV-Guided Training System — Implementation Plan

## Overview
Transform the existing Recovery page into an intelligent HRV-guided coaching system that calculates a 0–100 Readiness Score, tracks HRV trends against a 7-day baseline, and automatically adjusts the user's planned training session based on their readiness zone.

---

## Database Changes

**Modify `recovery_logs` table** — add columns:
- `hrv` (integer, nullable) — raw HRV in ms
- `rhr` (integer, nullable) — resting heart rate
- `stress` (integer, nullable) — 1-5 scale
- `energy` (integer, nullable) — 1-10 scale
- `rest_hours` (numeric, nullable)
- `adjusted_session` (jsonb, nullable) — stores the auto-adjusted workout for that day

**New table: `hrv_baselines`**
- `id`, `user_id`, `date`, `hrv_7day_avg`, `rhr_7day_avg`, `trend` (rising/stable/falling), `created_at`

This table gets populated each time a check-in is logged, storing the rolling averages for trend display.

---

## Readiness Score Engine (0–100)

Calculated from weighted inputs:

| Input | Weight | Method |
|-------|--------|--------|
| HRV vs 7-day baseline | 35% | % deviation mapped to 0–100 |
| Sleep quality (1–10) | 20% | Scaled to 0–100 |
| Fatigue (1–10, inverted) | 15% | (10 - fatigue) * 10 |
| Soreness (1–10, inverted) | 15% | (10 - soreness) * 10 |
| Mood (1–10) | 10% | Scaled to 0–100 |
| Previous training load | 5% | Based on last 3 days RPE avg |

If no HRV is entered, remaining weight redistributes to other metrics.

**Output Zones:**
- 85–100 → GREEN — "Push hard. Your body is primed."
- 70–84 → NORMAL — "Train as planned."
- 50–69 → CAUTION — "Reduce load. Recovery incomplete."
- <50 → RED — "Recovery focus. Easy movement only."

---

## Auto Training Adjustment Engine

After the morning check-in, the system reads today's planned session from the active training plan and modifies it:

- **GREEN**: Increase volume 10–15% (add reps/sets or extra intervals)
- **NORMAL**: No change
- **CAUTION**: Reduce volume 25%, lower RPE targets by 1–2
- **RED**: Replace with 20-min easy session + mobility

The adjusted session is stored in `recovery_logs.adjusted_session` and displayed on the dashboard's `DailyTrainingCard` instead of the original plan.

Example logic for a running interval session:
```text
Original: 6 × 800m @ RPE 8
GREEN:    7 × 800m @ RPE 8  (+1 rep)
CAUTION:  4 × 800m @ RPE 6  (-2 reps, -2 RPE)
RED:      20 min easy jog + 4 × strides + stretching
```

---

## Morning Check-In Flow (Revamped Recovery Page)

Restructure the Recovery page into a guided flow:

1. **HRV + RHR Input** — large, prominent fields at top
2. **Quick Sliders** — Sleep (1–5), Soreness (1–5), Stress (1–5)
3. **Submit** → calculates score, adjusts training, shows result

**Result screen shows:**
- Readiness Score (large ring, zone-colored)
- Zone label + short explanation with reasoning
- Today's adjusted session (before/after comparison)
- "Start Training" button

---

## Baseline + Trend Engine

- On each check-in, query last 7 days of `recovery_logs` where `hrv IS NOT NULL`
- Calculate rolling average, store in `hrv_baselines`
- Compute deviation: `(today_hrv - avg) / avg * 100`
- Trend direction from slope of last 7 values (rising if last 3 > avg, falling if last 3 < avg)

**Display:** Recharts `LineChart` showing HRV values vs baseline over 7–30 days with trend indicator text.

---

## Dashboard Integration

Modify `DailyTrainingCard`:
- If user has logged recovery today AND an adjusted session exists, show the adjusted session instead of the planned one
- Add a small readiness badge (colored dot + score) next to "Today's Schedule"
- If no check-in done yet, show a prompt: "Log your morning check-in" linking to Recovery

---

## Performance Insights (Premium)

Add a section at the bottom of Recovery (after check-in) showing:
- "Your best sessions happen when HRV is +5-10% above baseline"
- "Performance drops after 3+ days below baseline"
- Readiness streaks counter
- Weekly recovery score average

These are computed client-side from the last 30 days of `recovery_logs` + `performance_logs`.

---

## Gamification

- **Readiness Streak**: consecutive days with score 70+
- **Peak Days**: count of GREEN zone days this month
- **Weekly Recovery Score**: average readiness for the week
- Store streak in local state (computed from DB data, not a separate table)

---

## Monetisation

- **Free**: Basic readiness score (without HRV weighting), morning check-in
- **Premium** (Pro/Elite): HRV trend graphs, auto training adjustments, performance insights, peak detection

Use existing `useSubscription().hasFeature("hrv_insights")` pattern.

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/migrations/...` | Add columns to `recovery_logs`, create `hrv_baselines` table |
| `src/pages/Recovery.tsx` | Full rewrite: guided check-in flow, readiness display, trend chart, auto-adjustment, insights |
| `src/components/dashboard/DailyTrainingCard.tsx` | Show adjusted session when available, add readiness badge, add check-in prompt |
| `src/integrations/supabase/types.ts` | Auto-updated after migration |

---

## Technical Notes

- Readiness calculation and training adjustment logic are pure client-side functions (no edge function needed)
- HRV baseline calculation queries last 7 `recovery_logs` entries with non-null HRV
- Training adjustment modifies the session object in memory and stores the result in `adjusted_session` JSONB column
- Trend chart uses Recharts `LineChart` with `ReferenceLine` for baseline average

