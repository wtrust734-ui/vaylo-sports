const VAYLO = {
  company: {
    name: "Vaylo Sports",
    productCategory: "All-sports training, performance improvement and athlete development application",
    productType: "Digital sports technology product, primarily a mobile application, with a web application version also being developed",
    slogan: "Learn smarter. Train better. Perform better.",
    corePurpose: "Help athletes understand their performance, train more intelligently, improve their sporting ability, and make better training decisions.",
    positioning: "Premium, modern, ambitious sports technology platform",
    plannedLaunchDate: "2027-01-01",
    note: "Vaylo Sports is intended to serve athletes across sports. It must never be positioned as exclusively a running app, a gym app, a body-building app, or a generic fitness tracker. The long-term vision is to build a recognised sports technology brand that helps athletes improve across different sports and disciplines. The product should be presented as useful to athletes at different levels, from people beginning structured training to ambitious competitive athletes. Do not describe Vaylo as the largest, best, most accurate, most advanced or fastest-growing sports application unless independently verified evidence supports that specific claim.",
  },
  brand: {
    logo: {
      status: "SUPPLIED — this is the official Vaylo Sports logo. Use this artwork. Never generate, re-trace or approximate a stand-in.",
      mark: "A stylised brain drawn as a single continuous outline, with a short stem descending from its base. No wordmark, no lettering and no tagline inside the artwork.",
      appearance: "A blue-to-purple gradient outline on a solid black background.",
      colours: {
        background: "#000000",
        gradientStartBlue: "#0057FF",
        gradientEndPurple: "#8505D5",
        direction: "Blue at the upper left graduating to purple at the lower right",
      },
      assets: [
        {
          path: "src/assets/logo.jpg",
          role: "source of truth for the artwork — in-app brand mark (sidebar and header)",
          format: "JPEG",
          dimensions: "500x500",
          bytes: 14319,
          md5: "cb8b76404406401f685e4a3f8e66e977",
        },
        {
          path: "public/logo.png",
          role: "app icon — browser favicon, apple-touch-icon and social preview in the app shell",
          format: "PNG (RGBA)",
          dimensions: "256x256",
          bytes: 44785,
          md5: "d4e6966e04233d9f42121180503212b2",
        },
        {
          path: "website/assets/logo.png",
          role: "marketing site favicon, apple-touch-icon, Organization schema logo, header and footer mark",
          format: "PNG",
          dimensions: "128x128",
          md5: "b7e70bd62f4fb3aae743955187f75129",
        },
      ],
      usageRules: [
        "Never redraw, re-trace, recolour, re-gradient, add glow, add outline or add effects to the mark",
        "Never place the mark on a light or mid-tone background — the supplied artwork is drawn to sit on dark navy/black only",
        "Never stretch, squash or crop the mark; scale it proportionally and keep it square",
        "Keep clear space of at least 25% of the mark's height on every side",
        "Minimum legible sizes: 16px favicon, 24px in-app, 48px on video and picture-ad end cards",
        "Do not combine the mark with a wordmark, drop shadow, stroke or frame",
        "Do not present an AI-generated lookalike as the Vaylo logo",
      ],
      creativeNote: "The mark is a brain, which reads as intelligence rather than sport. Creative must not lean on AI/brain visual metaphors: the brand has to read as multi-sport athlete technology, not as a generic AI startup. The logo itself stays exactly as supplied.",
    },
    logoRule: "Do not redraw, distort, recolour or replace the official logo without authorisation",
    visualFoundation: ["dark navy","black"],
    accent: "restrained purple",
    typography: "modern, clean",
    styling: "Premium sports technology interface styling",
    composition: "High-contrast text, sharp compositions, clear visual hierarchy, dynamic but controlled movement, realistic sporting imagery, consistent branding across every campaign",
    branding: [
      "usable logo end card",
      "usable title treatment",
      "usable caption style",
      "usable CTA treatment",
      "usable app demonstration layout",
      "usable picture-ad layout"
    ],
    avoid: [
      "Excessive gradients",
      "Excessive neon effects",
      "Unnecessary glowing borders",
      "Cluttered layouts",
      "Generic AI-generated people with distorted anatomy",
      "Fake sports app screenshots",
      "Illegible text",
      "Overused stock-footage montages",
      "Inconsistent logos",
      "Visuals that make the brand appear like a gaming or cryptocurrency company"
    ],
  },
  audience: {
    coreAgeRange: "18-30",
    targetNote: "The primary planned target audience is athletes aged 18-30, including people who train regularly, participate in organised sport, compete recreationally or seriously, and want to improve their performance.",
    plannedSegments: [
      "Competitive athletes seeking structured improvement",
      "Amateur athletes who want better training guidance",
      "Athletes who struggle to organise their training",
      "Athletes who want to understand their performance and progress",
      "Athletes looking for personalised training recommendations",
      "Athletes who use technology to support their sporting development",
      "Athletes returning to structured training after a break",
      "Athletes who want a more organised approach to long-term development"
    ],
    segmentNote: "These are marketing hypotheses, not proven customer segments. The strategist must test which audiences respond best. Do not assume that all athletes have the same needs. A footballer, swimmer, runner, tennis player and basketball player require different examples, language and training contexts. Do not advertise Vaylo using running examples in every campaign. Use different sports and audience segments across the advertising portfolio. Make every example relevant to the advertised message. Any advertising aimed at younger users must comply with applicable privacy, consumer protection, platform and advertising rules. The intended core market remains 18-30.",
  },
  problemsAndMotivations: {
    problems: [
      "Athletes do not know how to structure their training",
      "Generic plans may not reflect an individual's needs",
      "Athletes struggle to understand whether they are progressing",
      "Training decisions can become inconsistent",
      "Athletes may not know how to adapt after missed sessions or interruptions",
      "Athletes may struggle to turn goals into a practical plan",
      "Sports information can be fragmented across different tools",
      "Athletes may need help understanding their training history and next steps"
    ],
    motivations: [
      "Become a better athlete",
      "Train with more purpose",
      "Reach a specific performance goal",
      "Understand personal strengths and weaknesses",
      "Build consistency",
      "Make better use of training time",
      "Feel more confident in training decisions",
      "Track progress over time"
    ],
    note: "Use these as hypotheses to guide creative development. Never claim that Vaylo solves a problem unless its current functionality actually supports that claim."
  },
  messaging: {
    brandTraits: [
      "Improvement through smarter training",
      "Personalisation rather than generic advice",
      "Athletic ambition and progression",
      "Practical usefulness",
      "Intelligent sports technology",
      "Better training decisions",
      "A broad, multi-sport identity",
      "A professional and credible athlete experience"
    ],
    brandNote: "The brand should feel like a serious technology company operating in the sports industry. It should not look like a cheap fitness template, a supplement company, a generic AI startup, or an influencer merchandise brand. The marketing must explain the practical value of Vaylo instead of relying on vague claims about innovation or artificial intelligence.",
  },
  objectives: [
    "Establish clear brand awareness",
    "Explain what Vaylo Sports does",
    "Generate genuine interest from the target audience",
    "Build a waitlist or other pre-launch audience if that mechanism is available",
    "Drive qualified users to the appropriate landing page or app listing",
    "Convert interested people into installs and registrations when the product is available",
    "Encourage activation and ongoing use",
    "Learn which audiences, messages and features create the strongest results",
    "Build a repeatable and affordable acquisition system"
  ],
  launchNote: {
    date: "2027-01-01",
    note: "The planned launch date has been 1 January 2027. Treat this as the current intended launch date, not a guarantee. Make it editable in the campaign settings and ask for an update if the schedule changes. The system must distinguish pre-launch marketing from live-product marketing. Before launch, do not use CTAs such as 'Download now' or 'Available now' unless the relevant product is actually available to the intended audience. Suitable pre-launch CTAs may include 'Join the waitlist', 'Follow Vaylo Sports' or 'Discover Vaylo', but only when the corresponding destination exists and works. After launch, use the actual app-store listing or supported acquisition destination."
  },
  budgetAndConstraints: {
    initialBudget: "Assume there is little or no initial advertising budget unless this is changed",
    priority: "maximise useful reach, qualified interest and learning per pound spent",
    note: "Do not assume that the company has an advertising agency, a paid production team, professional actors or an unlimited media budget. Design workflows that allow one person to manage the majority of campaign production.",
    productionPrincipals: [
      "Reusable templates",
      "Authentic app demonstrations",
      "Low-cost AI-generated footage",
      "Short and effective voiceovers",
      "Multiple edits from the same source assets",
      "Picture ads where video is unnecessary",
      "Organic social content",
      "Partnerships and collaborations where appropriate",
      "Referral and community strategies where appropriate",
      "Low-cost experiments before scaling spending"
    ],
    note2: "Never assume that free reach is guaranteed. Organic distribution is unpredictable and requires testing. Separate production spending from paid advertising spend. The platform must track both when the relevant data is available."
  },
  channels: [
    "TikTok",
    "Instagram Reels",
    "Instagram feed and Stories",
    "YouTube Shorts",
    "YouTube",
    "Relevant sports communities",
    "Sports clubs and athlete communities",
    "Relevant websites and newsletters",
    "Partnerships with coaches and sporting organisations",
    "Other channels that become appropriate as evidence develops"
  ],
  channelRule: "The strategist should select channels based on the audience, creative format, campaign objective and available resources. Do not automatically recommend every channel for every campaign. For each proposed channel, identify the intended audience, format, publishing requirements, CTA and measurement method. Do not publish advertisements automatically without explicit authorisation and the required integrations.",
  creativeFrameworks: [
    "Problem → solution → product demonstration → CTA",
    "Strong hook → relatable athlete situation → benefit → CTA",
    "Demonstration → explanation → reason to act",
    "Myth or misconception → useful insight → relevant Vaylo feature",
    "Athlete goal → training challenge → supported product solution",
    "Feature reveal → real demonstration → benefit",
    "Comparison of disorganised and structured training, without misleading claims",
    "A day in an athlete's training routine",
    "Educational content that provides genuine value",
    "A short cinematic sports opening followed by an authentic product demonstration",
    "Frequently asked questions",
    "Objection handling",
    "Feature-specific campaigns",
    "Brand story and founder-led messaging where suitable"
  ],
  creativeStrategy: {
    note: "The strategist must create advertisements that communicate one primary idea at a time. These are creative options, not mandatory templates. Avoid making every advertisement follow the same formula. For each campaign, generate three genuinely different concepts rather than three minor variations of the same video. The strategist should assess hook strength, message clarity, audience relevance, product truthfulness, visual quality, brand consistency, memorability, CTA relevance, production cost, expected ease of production and suitability for the chosen platform. Treat predicted performance as an estimate, not a fact.",
    hookApproaches: [
      "A recognisable sporting problem",
      "An unexpected visual",
      "A direct question",
      "A clear demonstration",
      "A specific training objective",
      "A common frustration",
      "An intriguing but truthful statement",
      "A strong visual contrast",
      "A useful insight that challenges a common assumption"
    ],
    hookNote: "The opening seconds should make the intended audience understand why the advert is relevant. Avoid misleading clickbait, exaggerated promises, generic motivational slogans and artificial urgency. Use natural language that athletes would understand. Do not cram multiple product benefits into a short advert. Focus on one main benefit and one clear CTA. Use captions that remain readable on mobile screens. Keep important text and logos within the appropriate safe areas for the target platform.",
  },
  videoRules: {
    lengths: "The strategist may test short 6-15 second edits and longer 15-30 second demonstrations where appropriate. These are starting points, not universal platform requirements.",
    productionProcess: [
      "Write the strategy and script",
      "Select or upload appropriate source footage",
      "Identify which scenes genuinely need generated visuals",
      "Generate only those scenes",
      "Add real Vaylo interface footage where appropriate",
      "Create narration if it improves the message",
      "Add captions, logo, music and CTA",
      "Render and review",
      "Correct errors before publishing"
    ],
    note: "Prioritise continuity, realistic sporting movement, consistent lighting and correct human anatomy. Avoid generating text inside footage when the text can be overlaid accurately during editing. Do not show invented app functionality or imply that AI-generated athletes are real Vaylo customers.",
  },
  pictureRules: {
    hierarchy: [
      "Main message",
      "Relevant supporting visual",
      "One concise supporting point if needed",
      "Brand identity",
      "CTA where appropriate"
    ],
    note: "Picture ads must have one clear visual hierarchy. Use authentic screenshots when the purpose is to demonstrate the product. Use generated sports imagery when it improves the concept and does not falsely imply an endorsement or real customer experience. Create variations for different audience segments and messages, not simply different background colours. Check spelling, contrast, readability, logo integrity and platform dimensions before exporting."
  },
  voiceMusicSound: {
    narration: "Use ElevenLabs for narration when connected and suitable. The voice should fit the audience and campaign. It should sound clear, credible and natural rather than exaggerated or artificially enthusiastic. Allow a choice of voice style, speaking pace, language and supported delivery settings.",
    soundDesign: "Use sound design selectively. Do not let music overpower narration or distract from the message. Use only music and sound effects with appropriate commercial usage rights. Allow text-only and silent versions when appropriate."
  },
  complianceAndTrust: {
    rules: [
      "Avoid fake testimonials",
      "Avoid fabricated reviews",
      "Avoid invented statistics",
      "Avoid unsupported health or performance claims",
      "Avoid guaranteed athletic results",
      "Avoid misleading comparisons",
      "Avoid unlicensed music or footage",
      "Avoid unauthorised use of people's likenesses or voices",
      "Avoid deceptive CTAs and fake urgency",
      "Respect relevant privacy, consent and advertising requirements",
      "Clearly distinguish fictional demonstrations from real customer experiences where necessary"
    ],
    medicalNote: "Do not imply that Vaylo diagnoses, treats or prevents medical conditions unless the product has the necessary substantiation and authorisation.",
    note: "All creative must be truthful, transparent and compliant with applicable laws and platform rules."
  },
  generationConstraints: {
    noFakeScreens: "Do not invent interface elements, charts, statistics or features and portray them as real Vaylo screens.",
    conceptualMockupNote: "AI-generated mock-ups may be used for conceptual work, but they must not be misrepresented as the current application.",
    demoAssets: [
      "Actual Vaylo app screen recordings",
      "App screenshots",
      "Navigation demonstrations",
      "Real training-plan examples",
      "Real feature demonstrations",
      "Brand assets and logos",
      "Approved athlete footage",
      "Existing advertisements",
      "Reference material"
    ],
    demoNote: "When real app footage is provided, the AI should inspect it, identify its useful sections, and recommend how to incorporate them into an advert. For example, a video advert might open with relevant sporting footage, introduce a training problem, show a genuine Vaylo feature, explain its practical benefit, and finish with a clear CTA."
  }
};

export const VAYLO_BRAND = VAYLO;

export const VayloBrand = {
  company: VAYLO.company,
  brand: VAYLO.brand,
  audience: VAYLO.audience,
  problemsAndMotivations: VAYLO.problemsAndMotivations,
  messaging: VAYLO.messaging,
  objectives: VAYLO.objectives,
  launchNote: VAYLO.launchNote,
  budgetAndConstraints: VAYLO.budgetAndConstraints,
  channels: VAYLO.channels,
  channelRule: VAYLO.channelRule,
  creativeFrameworks: VAYLO.creativeFrameworks,
  creativeStrategy: VAYLO.creativeStrategy,
  videoRules: VAYLO.videoRules,
  pictureRules: VAYLO.pictureRules,
  voiceMusicSound: VAYLO.voiceMusicSound,
  complianceAndTrust: VAYLO.complianceAndTrust,
  generationConstraints: VAYLO.generationConstraints,
};

export const VAYLO_PRODUCT_FEATURES = VAYLO;
