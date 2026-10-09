# 34 — AI Data Processing & Risk Assessment

**Drafted 2026-10-02. Internal. Owner: unassigned.**

> **The single most important fact in this document: no AI provider is deployed.** The AI
> features fail closed. Nothing is sent anywhere today. This assessment therefore describes
> intended processing and the risks of enabling it — it is the thing to read *before* enabling,
> not a description of current behaviour.

## 1. What the AI features are intended to do

Six feature families produce generated text, with two more producing structured output:

| Feature | Intended input | Intended output |
|---|---|---|
| Suggested training plan | Recent sessions, volume, load, age band | A training plan |
| Weekly review | A week of sessions and load | Prose review |
| Coaching chat | Athlete-typed text plus recent training context | Conversational reply |
| Video form analysis | The athlete's clip plus the movement being analysed | Technique feedback |
| Natural language goals | The goal text typed in | A structured goal |
| Other structured output | Aggregated training figures | Derived metrics |

## 2. Intended processing path

The published `ai-data-use.html` states a five-step path, and it is the correct design:

1. The app calls **our** edge function, authenticated as the athlete.
2. The function checks entitlement.
3. The function sends the provider only the fields that feature needs.
4. The provider's response returns to our function.
5. Our function passes text back to the app.

The provider therefore never sees a session token, a password, an email address, a payment
detail, or another athlete's data. That is a genuine minimisation property and worth keeping.

## 3. Data that would be sent, by category

| Category | Would be sent? | Note |
|---|---|---|
| Derived training metrics (load, recovery, readiness) | Yes | **Special category health data**, inferred from lifestyle |
| Session volume, distance, duration | Yes | Implied by the above |
| Age band | Yes | Needed to cap volume for under-18s |
| Date of birth | No — age band only | Deliberate: sending an exact DOB is more identifying than needed |
| Name, email | No | Not needed by any feature |
| Password, session | No | Never leaves our server |
| Payment details | No | Not stored |
| Community posts, messages | No | Not in any prompt |
| Injury logs | **Should not be sent** | Verify no feature reads them; an injury in a prompt would be a disclosure |
| Mental check-ins | **Must not be sent** | Highly sensitive, freely given, possibly by a minor |
| Other athletes' data | No | Provider sees only the requesting athlete's context |
| Video clip (video features only) | Yes | The clip plus the movement, nothing else |

**The two rows in bold are requirements, not descriptions.** They are the kind of thing that
gets broken by a later "just include the context" change, so they belong in code review as
explicit checks rather than in a document.

## 4. Open questions that must be answered before enabling anything

### 4.1 Retention and training — currently unverifiable

Published policy deliberately does **not** claim that prompts are not used to train a general
model. That is the right call: we have not done the review, so we cannot evidence it.

To answer it:

- confirm the provider's contractual terms on training on submitted content;
- confirm the account configuration actually has training opt-out enabled;
- record the provider's retention period for prompts and responses;
- re-write the corresponding section of `ai-data-use.html` to state what is true, before the
  features are enabled rather than after.

### 4.2 Special category data

Derived training metrics are health data under the applicable regime. Sending them to a
third-party processor needs a lawful basis and a transfer mechanism. Both are unrecorded
(document 33).

### 4.3 Automated decision-making

Currently there is none: AI output is shown to an athlete as text and does not determine access
or entitlement. **This must remain true.** If AI output ever gates a purchase, a limit, an
access decision or a safety control, that is automated decision-making and changes the analysis
substantially.

## 5. Risks of enabling

| # | Risk | Impact | Mitigation available now |
|---|---|---|---|
| A1 | Prompts retained or used for model training | High | Unresolved — §4.1 |
| A2 | Health data reaches a third party without a transfer basis | High | Record the basis before enabling |
| A3 | A generated answer gives harmful training or nutrition advice | High | Under-18 nutrition features are switched off in code; feature-level disclaimers; but **no output filter exists** |
| A4 | A hallucinated answer is treated as clinical advice | High | Disclaimers in `ai-training-advice.html`; verified? not technically |
| A5 | A prompt containing an injury or mental disclosure is sent | Medium | Must be enforced in code, not policy |
| A6 | A clip is retained by a third party | Medium | Unresolved until a provider is chosen |
| A7 | Cost/availability outage on an AI call | Low | Features already fail closed |
| A8 | An athlete is shown a confident answer about a child-safety or medical matter | High | No guardrail exists |

## 6. Required before enabling, in order

1. Pick a provider and complete §4.1. **Blocking.**
2. Record the transfer basis and the processor entry (document 33). **Blocking.**
3. Add code-level assertions that injury and mental data are never read into a prompt, and put
   them in the test suite so they cannot regress. **Blocking.**
4. Rewrite the "training" section of `ai-data-use.html` to match reality.
5. Confirm features still fail closed if the provider is unavailable.
6. Add output filtering or a refusal behaviour for nutrition, weight, injury and
   child-safety-adjacent prompts. Currently absent — a real gap, not a theoretical one.

## 7. What cannot be concluded here

- Whether any provider's terms permit our intended use. No provider has been chosen or reviewed.
- Whether the current incident or breach plan covers a provider-side disclosure. It does not
  (document 31, B6).
- Whether outputs are accurate. They are generated, and a plausible wrong answer is the normal
  failure mode — no accuracy claim is made anywhere in the published documents.