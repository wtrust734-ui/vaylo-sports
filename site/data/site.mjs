// ============================================================================
// SITE CONFIGURATION — the only place site-wide facts are declared
// ----------------------------------------------------------------------------
// Everything here was read out of the Vaylo Sports codebase. Nothing is
// invented, and where a fact does not exist yet it is `null` with a note saying
// so, rather than a plausible-looking value. The generator refuses to emit a
// page that links a null value, which is what stops a placeholder becoming a
// shipped lie.
//
// The operator name and contact email are NOT here — they come from
// legal/operator.json, so the website and the published legal documents can
// never disagree about who runs the product.
// ============================================================================

export const SITE = {
  /** Shown in the title bar, footer and structured data. */
  name: "Vaylo Sports",

  /**
   * Public origin, used for canonical URLs, the sitemap and Open Graph.
   * Read from SITE_URL at build time. Null means "no public origin configured",
   * and the generator emits relative canonicals rather than inventing one.
   */
  url: process.env.SITE_URL || null,

  /**
   * Google Play listing.
   *
   * There is no listing yet, so this is null and the homepage renders an honest
   * "not yet on the Play Store" panel instead of a link to a package that does
   * not exist. Set it to the real listing id when there is one — nothing else
   * on the site needs to change.
   */
  playStoreUrl: process.env.PLAY_STORE_URL || null,
  playStorePackage: process.env.PLAY_STORE_PACKAGE || null,

  /** Android-only today. Stated plainly rather than implied away. */
  platforms: ["Android"],

  /**
   * Footer copyright line. Uses the brand name, not a legal entity — the
   * registered company name is not yet known and must not be guessed here.
   */
  copyrightYear: 2026,

  /**
   * The last date the site's own copy changed, used as the sitemap's <lastmod>
   * for any page that does not carry its own `updated` date.
   *
   * It is a hand-maintained constant rather than `new Date()` on purpose. A
   * build timestamp would make the sitemap differ between two generations of
   * the same source, and src/lib/website.test.ts regenerates the site twice and
   * compares the results — a clock in the output would report that as staleness
   * on every run, which is a test that gets muted rather than fixed. It would
   * also be a lie: <lastmod> means the content changed, not that a deploy did.
   */
  contentUpdated: "2026-10-08",

  /**
   * The social card every page shares unless it declares its own.
   *
   * Before this existed, og:image was simply absent, so every link to any of
   * the site's pages rendered as a bare grey rectangle in a chat or on a
   * timeline — which for an app whose distribution is somebody pasting a link
   * into a group chat is the most expensive thing the site was missing.
   *
   * 1200x630 is the size every major platform crops from. It is a checked-in
   * source asset (site/assets/og.png) copied out by the generator rather than
   * drawn at build time, so a build machine needs no browser to produce it.
   */
  ogImage: "/assets/og.png",

  /** Alt text for that card. It is the honest one-line description of what the
   * image shows, not a repeat of the page title. */
  ogImageAlt:
    "Vaylo Sports — a training log that works across every sport, showing the app name and the four facts the site leads with.",

  /**
   * Supabase project used by the website forms. Read from the same env var the
   * app uses. When it is absent the forms refuse to pretend and fall back to
   * showing the real email address — see forms.js.
   */
  supabaseUrl: process.env.VITE_SUPABASE_URL || null,
};

// ---------------------------------------------------------------------------
// Primary navigation
// ---------------------------------------------------------------------------

export const NAV = [
  { href: "/features/", label: "Features" },
  // The screen-by-screen preview. In the nav rather than only in the sitemap
  // because a person deciding whether to install has the same question a
  // crawler does: what is actually in it?
  { href: "/safety/", label: "Safety" },
  // In the top nav rather than only in the footer, because it is the page that
  // decides whether a visitor stays: the 26 legal documents answer "what are my
  // rights", and nothing else on the site answered "does this work with my
  // Garmin" until this page existed.
  { href: "/faq/", label: "FAQ" },
  // In the nav, not just linked from the homepage: the app is not on the Play
  // Store yet, and this is where someone who wants it goes to say so.
  { href: "/waitlist/", label: "Waiting list" },
  // Deliberately in the same nav as everything else rather than hidden in a
  // footer. A brand looking for the ad slots should be able to find the page
  // without being told where it is, and a visitor should be able to see that
  // there is a commercial side and read what it is allowed to do.
  { href: "/sponsors/", label: "Sponsors" },
  { href: "/legal/", label: "Legal" },
  { href: "/support/", label: "Support" },
  { href: "/about/", label: "About" },
  { href: "/contact/", label: "Contact" },
];

// ---------------------------------------------------------------------------
// Footer — required on every page.
//
// These point at the website's own routes, which embed the published documents
// verbatim. The generator fails if a footer entry resolves to nothing, so a
// document deleted from legal/ breaks the build rather than the site.
// ---------------------------------------------------------------------------

export const FOOTER = [
  {
    heading: "Legal",
    links: [
      { href: "/legal/", label: "Legal Centre" },
      { href: "/legal/terms/", label: "Terms of Service" },
      { href: "/legal/privacy/", label: "Privacy Policy" },
      { href: "/legal/child-safety/", label: "Child & Young Athlete Safety" },
      { href: "/legal/child-safety/#young-notice", label: "Children's Privacy Notice" },
      { href: "/legal/cookies/", label: "Cookie Policy" },
      { href: "/legal/ai-disclaimer/", label: "AI Disclaimer" },
      { href: "/legal/health-safety/", label: "Training & Medical Disclaimer" },
      { href: "/legal/health-safety/#safety-guidelines", label: "Safety Guidelines" },
      { href: "/legal/community-guidelines/", label: "Community Guidelines" },
      { href: "/legal/community-guidelines/#acceptable-use", label: "Acceptable Use Policy" },
      { href: "/legal/purchases/", label: "Subscription & Billing Terms" },
      { href: "/legal/refunds/", label: "Refund & Cancellation Policy" },
      { href: "/legal/purchases/#virtual-items", label: "Credits & Virtual Items Terms" },
      { href: "/legal/competition-terms/", label: "Competition Terms" },
      { href: "/legal/contact/", label: "Contact / Legal" },
      { href: "/legal/account-deletion/", label: "Delete Account & Data" },
      { href: "/legal/data-rights/", label: "Privacy Rights Request" },
      { href: "/legal/report-safety-concern/", label: "Report a Safety Concern" },
      { href: "/legal/report-content/", label: "Report Content / User" },
      { href: "/legal/security-disclosure/", label: "Security / Vulnerability Reporting" },
      { href: "/legal/complaints/", label: "Complaints Procedure" },
    ],
  },
  {
    heading: "Safety & AI",
    links: [
      { href: "/legal/ai-training-advice/", label: "AI Training Advice Disclaimer" },
      { href: "/legal/video-analysis-disclaimer/", label: "Video Analysis Disclaimer" },
      { href: "/legal/injury-guidance/", label: "Injury & Return-to-Training" },
      { href: "/legal/nutrition-disclaimer/", label: "Nutrition Disclaimer" },
      { href: "/legal/mental-wellbeing/", label: "Mental Wellbeing" },
      { href: "/legal/wearable-health-privacy/", label: "Wearable & Health Data" },
      { href: "/legal/ai-data-use/", label: "AI Data Use & Processing" },
      { href: "/legal/advertising/", label: "Advertising & Tracking" },
    ],
  },
  {
    heading: "Product",
    links: [
      { href: "/features/", label: "Features" },
      { href: "/faq/", label: "Questions & Answers" },
      { href: "/whats-new/", label: "What has changed" },
      { href: "/safety/", label: "Safety Centre" },
      { href: "/accessibility/", label: "Accessibility" },
      { href: "/about/", label: "About Vaylo" },
      { href: "/contact/", label: "Contact" },
      { href: "/support/", label: "Support" },
      { href: "/sponsors/", label: "Sponsor Vaylo Sports" },
      { href: "/privacy/", label: "Privacy & Data Centre" },
      { href: "/delete-account/", label: "Delete your account" },
      { href: "/legal/intellectual-property/", label: "Intellectual Property" },
    ],
  },
];

// ---------------------------------------------------------------------------
// The published documents, with the one-line summary each needs.
// Twelve were added on 2026-10-02, so this must track legal/pages.json.
//
// Descriptions describe what the document is for. They are not claims about the
// product beyond what the document itself says.
// ---------------------------------------------------------------------------

export const LEGAL_DOCUMENTS = [
  {
    slug: "privacy",
    title: "Privacy Policy",
    summary: "What the app collects, why, who else processes it, how long we keep it, and your rights.",
  },
  {
    slug: "terms",
    title: "Terms of Service",
    summary: "The agreement between you and Vaylo Sports, including credits, AI output and liability.",
  },
  {
    slug: "ai-disclaimer",
    title: "AI & Coaching Disclaimer",
    summary: "Which features are generated by a language model, which are plain arithmetic, and why both can be wrong.",
  },
  {
    slug: "health-safety",
    title: "Training & Health Safety Notice",
    summary: "What the load, recovery and readiness numbers mean, and when to stop and see a professional.",
  },
  {
    slug: "community-guidelines",
    title: "Community Guidelines",
    summary: "What is acceptable in the feed, communities and challenges, and what we do when it is not.",
  },
  {
    slug: "child-safety",
    title: "Child & Young Athlete Safety",
    summary: "What is switched off for under-18s, the age caps, and how to report a concern.",
  },
  {
    slug: "advertising",
    title: "Advertising & Tracking Disclosure",
    summary: "There is no ad SDK, no analytics SDK and no advertising identifier. Here is exactly what exists.",
  },
  {
    slug: "purchases",
    title: "Credits, Subscriptions & Virtual Currency",
    summary: "What credits are, what they cost, and the limits on what buying gives you.",
  },
  {
    slug: "refunds",
    title: "Refunds & Cancellation",
    summary: "How to cancel a subscription, when we will refund you, and where your statutory rights still apply.",
  },
  {
    slug: "account-deletion",
    title: "Deleting Your Account",
    summary: "Every step of deleting your account and its data, and the one anonymous record that survives.",
  },
  {
    slug: "data-rights",
    title: "Your Data Rights",
    summary: "Access, correction, portability, erasure, objection, and how to complain to a regulator.",
  },
  {
    slug: "intellectual-property",
    title: "Intellectual Property",
    summary: "What you own, what we own, and how to make a copyright complaint.",
  },
  {
    slug: "cookies",
    title: "Cookie Policy",
    summary: "The one cookie this website sets, and the settings the app stores on your device.",
  },
  {
    slug: "competition-terms",
    title: "Competitions & Promotion Terms",
    summary: "How challenges, leaderboards and referral promotions work, and what a reward actually is.",
  },
  {
    slug: "report-safety-concern",
    title: "Report a Safety Concern",
    summary: "If something is unsafe, or a child is at risk, and how to tell us.",
  },
  {
    slug: "report-content",
    title: "Report Content or a User",
    summary: "What the report button does, what happens next, and how blocking works.",
  },
  {
    slug: "security-disclosure",
    title: "Security & Vulnerability Reporting",
    summary: "Where to send a flaw, our safe-harbour promise, and what is out of scope.",
  },
  {
    slug: "complaints",
    title: "Complaints Procedure",
    summary: "How to complain, ask for a review, or take it to a regulator.",
  },
  {
    slug: "ai-training-advice",
    title: "AI Training Advice Disclaimer",
    summary: "Why the suggestions are not a coach, a physio or a doctor.",
  },
  {
    slug: "video-analysis-disclaimer",
    title: "Video Analysis Disclaimer",
    summary: "What a clip estimate can tell you, and what it cannot.",
  },
  {
    slug: "injury-guidance",
    title: "Injury & Return-to-Training Guidance",
    summary: "When to stop training, and the rough shape of coming back.",
  },
  {
    slug: "nutrition-disclaimer",
    title: "Nutrition Disclaimer",
    summary: "General fuelling information, and why it is not a diet plan.",
  },
  {
    slug: "mental-wellbeing",
    title: "Mental Wellbeing & Healthy Training",
    summary: "Training and mood, what we cannot monitor, and where to get real help.",
  },
  {
    slug: "wearable-health-privacy",
    title: "Wearable & Health Data Privacy Notice",
    summary: "What a connected watch sends, what we do with it, and how to remove it.",
  },
  {
    slug: "ai-data-use",
    title: "AI Data Use & Processing Notice",
    summary: "Exactly what is sent to an AI provider, what is never sent, and what we cannot yet promise.",
  },
  {
    slug: "waitlist-terms",
    title: "Waiting List Terms",
    summary: "What joining the waiting list means, what it costs, and what happens to your email address.",
  },
  {
    slug: "contact",
    title: "Contact & Support",
    summary: "How to reach a person, what is urgent, and what we have not committed to.",
  },
];

// ---------------------------------------------------------------------------
// Sports.
//
// Taken from the sport pickers the app actually ships: Profile, Training and
// Onboarding. Vaylo is not a running app and must never be described as one,
// but it is also not infinitely all-sports — the picker is a closed list, and
// listing what it really contains is more useful than "any sport you like".
// ---------------------------------------------------------------------------

export const SPORTS = [
  "Running", "Cycling", "Swimming", "Football", "Basketball", "Tennis",
  "Rugby", "Athletics", "Triathlon", "Boxing", "MMA", "Cricket",
  "Gym / Weightlifting", "CrossFit", "Climbing", "Rowing", "Volleyball",
  "Hockey", "Badminton", "Gymnastics", "Wrestling", "Golf", "Combat Sports",
  "Martial Arts", "Other",
];

// ---------------------------------------------------------------------------
// Features.
//
// Three groups, because pretending they are all equally available is the kind
// of thing this product's legal documents would (correctly) contradict:
//
//   live   — works today, signed in
//   soon   — built and in the app, but the server capability is not switched
//            on, so the app tells the athlete so when they open it
//   off    — deliberately disabled at launch, with the reason recorded in
//            src/config/featureFlags.ts
//
// The `soon` and `off` groups are published because hiding them would make the
// website describe a product that does not exist.
// ---------------------------------------------------------------------------

export const FEATURES = [
  {
    group: "Train and log",
    status: "live",
    items: [
      {
        name: "Performance Log",
        body: "Log sessions with RPE, duration, notes and form. It is the record everything else is calculated from.",
      },
      {
        name: "Training plans",
        body: "Week-by-week plans built from what you have logged, your sport and your availability.",
      },
      {
        name: "Routines",
        body: "Your own repeatable sessions, with history, so a good week is not rebuilt from memory.",
      },
      {
        name: "Goals and event preparation",
        body: "Set goals, track them against your log, and work towards a specific event.",
      },
    ],
  },
  {
    group: "Understand your training",
    status: "live",
    items: [
      {
        name: "Performance Dashboard",
        body: "Readiness, acute load, A:C ratio, calories, protein and an injury-risk flag, calculated from your own entries.",
      },
      {
        name: "VPR performance rating",
        body: "A single rating built from the metrics you log. Arithmetic on your data — not a prediction and not AI.",
      },
      {
        name: "Limiter Test",
        body: "Find which limiter is holding you back, then work on that one rather than guessing.",
      },
      {
        name: "Development trajectory",
        body: "A trend line across your own VPR history. It describes what happened; it does not forecast what will.",
      },
      {
        name: "Equipment Tracker",
        body: "Log the gear you train on and rotate it before it becomes the problem.",
      },
    ],
  },
  {
    group: "Recovery, injury and the body",
    status: "live",
    items: [
      {
        name: "Recovery tracking",
        body: "Sleep, soreness, mood and energy, and how they read next to your training load.",
      },
      {
        name: "Injury Management",
        body: "A generic return-to-play scaffold to organise a rehab you have already been given. It does not diagnose, and it carries a permanent notice telling you to see a physiotherapist or doctor.",
      },
      {
        name: "Nutrition",
        body: "Calorie and protein tracking against your training. Restricted to athletes aged 18 and over.",
      },
      {
        name: "Form analysis",
        body: "Upload video of a lift or movement and review it frame by frame against your own earlier sets.",
      },
    ],
  },
  {
    group: "Skill and tactics",
    status: "live",
    items: [
      {
        name: "Learning Hub",
        body: "Written lessons, drills and quizzes across sports, including load management for growing athletes.",
      },
      {
        name: "Tactical analysis",
        body: "Organise opponents, read matchups and keep notes on what worked.",
      },
      {
        name: "Cross-training",
        body: "Work out what a second sport is doing for your first one, and where the two are pulling against each other.",
      },
      {
        name: "Compare",
        body: "Put two periods side by side and see what actually changed.",
      },
    ],
  },
  {
    group: "Motivation and progress",
    status: "live",
    items: [
      {
        name: "Mental Gym",
        body: "Work on the mental side of competing — pre-performance routines, focus and managing a bad day.",
      },
      {
        name: "Personal bests and streaks",
        body: "Record your bests, keep a streak, and buy a shield for the day you miss.",
      },
      {
        name: "Achievements and trophies",
        body: "Milestones worth collecting as you build consistency.",
      },
      {
        name: "Event Packs",
        body: "Structured programmes for a specific event, from beginner to elite, with taper and race-day guidance.",
      },
      {
        name: "Arcade",
        body: "A short arcade break built around your training, for the days when the training is done.",
      },
    ],
  },
  {
    group: "The community side",
    status: "live",
    items: [
      {
        name: "Feed",
        body: "Share a session, achievement, goal or personal best — and see what other athletes choose to share. Private by default.",
      },
      {
        name: "Communities and challenges",
        body: "Group by sport, and take on a challenge alongside other athletes.",
      },
      {
        name: "Leaderboard and friends",
        body: "See where you sit, follow the athletes you want to train alongside.",
      },
      {
        name: "Report and block",
        body: "Report harmful content from any post or profile, and block any athlete. Blocking is not disclosed to them.",
      },
    ],
  },
  {
    group: "AI features",
    status: "soon",
    note: "These are built into the app and appear in its navigation, but the server capability that runs them is not switched on yet. The app tells the athlete so when they open the feature, rather than showing a broken result. We would rather say this than advertise something that does not answer.",
    items: [
      { name: "Vaylo Coach chat", body: "Free-text conversation about your training, with generated replies." },
      { name: "Generated training weeks", body: "A plan written for your current week rather than a template." },
      { name: "Weekly coach review", body: "Generated feedback on your goals and your consistency." },
      { name: "Video form analysis", body: "Generated commentary on a video you upload." },
      { name: "Calorie scan and nutrition plans", body: "Generated eating plans. Restricted to athletes aged 18 and over." },
      { name: "Tactical briefings", body: "Generated match-up notes from your own description." },
    ],
  },
  {
    group: "Not switched on",
    status: "off",
    note: "Deliberately disabled, with the reason recorded in the code. They may change; nothing below is promised.",
    items: [
      {
        name: "Wearable and health sync",
        body: "Strava, Garmin, Fitbit, Oura, WHOOP, Polar, Suunto, COROS and Android Health Connect. The integration needs signed developer agreements with each provider before it can exchange a token, so no data moves.",
      },
      {
        name: "GPS tracking",
        body: "Live distance during a workout. The Android build does not request location permission at all, so it is inert by design rather than by oversight.",
      },
      {
        name: "Coach marketplace",
        body: "Buying coaching. The surface is built but ships with no coaches, and an empty marketplace is worse than no marketplace.",
      },
    ],
  },
];