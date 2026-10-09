# 40 — AI Safety & Risk Management Procedure

**Drafted 2026-10-02. Internal. Owner: unassigned.**

> **No AI provider is deployed.** The AI features fail closed and return an error. This
> document describes the failure modes of generated output and what must exist before the
> features are enabled. It is a pre-launch document, not a description of current behaviour.

## 1. Why generated output needs its own risk process

A generated answer about a young athlete's training can be **fluent, specific, plausible and
wrong**. The failure mode is not an error message; it is confident text that a tired athlete at
the end of a hard session acts on. That is a different risk class from a crash, and it needs
controls that a normal software review does not look for.

## 2. Failure modes

| ID | Failure mode | Who is hurt | Realistic? |
|---|---|---|---|
| F1 | Confidently wrong training advice that causes an increase in load at the wrong time | The athlete | **Very** |
| F2 | Advice to train through pain or injury | The athlete | Realistic |
| F3 | Under-eating or calorie advice to a young athlete | **A minor** | Mitigated only by the feature being switched off in code |
| F4 | Unsafe weight-loss framing | The athlete, disproportionately a young athlete or someone with an eating disorder | Realistic |
| F5 | Medical framing — "this is likely a stress fracture" | The athlete | **Very** — models produce medical-sounding text unprompted |
| F6 | Mental-health framing from a mood check-in | A vulnerable athlete | Realistic if mental data ever reaches a prompt |
| F7 | Response that flatters the athlete and reinforces overtraining | A young athlete | Realistic — agreeable answers are the most common pattern |
| F8 | Response that is inclusive in tone but wrong for the athlete's age, sex, disability or sport | The athlete | Realistic |
| F9 | Athlete treats output as a clearance to return to training | The athlete | **Very** — and the app has a return-to-play context |
| F10 | Prompt content leaking to a third-party provider | The athlete | Depends on the provider; unresolved (document 34) |
| F11 | Generated content scraped, quoted or attributed as Vaylo advice | The athlete | Realistic once content is shareable |
| F12 | Costs or availability failure mid-workout | The athlete | Realistic |

## 3. Controls already in place

| Control | Status |
|---|---|
| Nutrition and calorie features unavailable to under-18s | Implemented in code — so F3 cannot occur for a minor via the app |
| AI features fail closed with no provider deployed | Implemented — nothing is sent today |
| Prompts routed through our server, never device-to-provider | Implemented by design |
| Disclaimers in `ai-disclaimer.html`, `ai-training-advice.html`, `video-analysis-disclaimer.html`, `nutrition-disclaimer.html` | Published |
| Video clips excluded from public profiles | Implemented |
| AI output is not published to profile or feed | Implemented |

**None of these are output controls.** Every one of them is a pre-condition, a routing choice or
a disclaimer. There is **no mechanism that examines what the model said**.

## 4. Controls that do not exist

| ID | Missing control | Addresses | Priority |
|---|---|---|---|
| A-1 | **No output filtering or refusal behaviour** for nutrition, weight, injury, medical or child-safety-adjacent prompts | F3, F4, F5 | **Critical before launch** |
| A-2 | **No prompt-time guardrails.** Nothing prevents a user asking "should I train through this pain?" and receiving an answer | F2, F9 | **Critical before launch** |
| A-3 | **No detection of injury or mental data in a prompt context** | F6 | High |
| A-4 | **No evaluation set.** No corpus of prompts with known-bad answers, so no way to detect a regression | F1, F5, F8 | High |
| A-5 | **No output logging** that would let a bad answer be investigated | All | High |
| A-6 | **No accuracy claim is made anywhere**, which is correct — but there is also no monitoring of whether answers are harmful in practice | F1, F7 | Medium |
| A-7 | **No age-appropriateness check on generated content** | F8 | Medium |
| A-8 | **No kill switch.** Nothing disables a feature remotely if a model or prompt produces harmful output | All | **Critical before launch** |

## 5. Required before enabling, in order

1. **A kill switch.** A feature flag that disables an AI feature without shipping a build. If
   something goes wrong at scale, the response time is otherwise an app release.
2. **Prompt-time refusals.** Topics that must be refused rather than answered: training through
   pain, injury clearance, calorie or weight targets, any medical diagnosis, and anything
   concerning self-harm. The app should decline and point to a person.
3. **Output filtering** as a second line, since prompt filtering alone will be bypassed.
4. **An evaluation set** of prompts with known-bad answers, run on every prompt or model change.
5. **Output logging** with a defined retention, for investigation.
6. **Complete the provider review** (document 34 §4) — retention, training use, data residency,
   and a contractual basis for transferring health data.
7. **Re-write the AI Data Use policy section** that currently refuses to claim prompts are not
   used for training.

## 6. Standing rule

**Generated output must never be the last word on an athlete's health or safety.**

A suggestion may prompt a thought. It may not clear a return to training, endorse a change in
load, address weight, or answer a question about pain. Where an athlete asks one of those, the
right product behaviour is to decline and say who to ask — which is what the published
disclaimers already say in prose, and what the code should do in behaviour.

That rule is stated here because it is the kind of thing that decays: each individual prompt
change looks harmless, and the constraint erodes one small exception at a time.

## 7. What cannot be completed here

- Whether a chosen provider's safety features are adequate. No provider has been evaluated.
- What a defensible evaluation set looks like for F1 and F5 — this requires a domain expert and
  a clinical adviser, neither of whom has been engaged.
- Whether the AI features should exist at all for under-18s in their current form. That is a
  product and safeguarding judgement, and it has not been made.