// GENERATED FILE — do not edit by hand.
//
// Produced by scripts/gen-legal-pages.cjs from the HTML in legal/ and the
// operator details in legal/operator.json. Edit the sources there and re-run
// the script; src/lib/legalPages.test.ts fails if this file and those sources
// disagree, so a forgotten run is caught in CI rather than in production.

export interface LegalPage {
  title: string;
  html: string;
}

/**
 * True while legal/operator.json still holds its REPLACE_ME placeholders.
 * index.ts refuses to serve anything in that state, so a policy naming the
 * wrong company or a dead inbox cannot be published or reviewed.
 */
export const OPERATOR_DETAILS_UNSET = true;

export const OPERATOR_NAME = "REPLACE_ME";
export const CONTACT_EMAIL = "REPLACE_ME";

export const LEGAL_PAGES: Record<string, LegalPage> = {
  "privacy": {
    title: "Privacy Policy",
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Privacy Policy — Vaylo Sports</title>
<!--
  ============================================================================
  OPERATOR DETAILS ARE TOKENS
  ----------------------------------------------------------------------------
  "REPLACE_ME" and "REPLACE_ME" are replaced at publish time from
  LEGAL_OPERATOR_NAME / LEGAL_CONTACT_EMAIL (see supabase/functions/legal/).
  They are deliberately left unresolved here so compiled output containing a
  guessed company name or a dead inbox cannot reach a public URL — a privacy
  policy with a non-working contact is worse than no policy, and Play reviews
  this page by hand.

  This page is also the app's in-app "Privacy Policy" link, so it must stay
  self-contained: no fonts, scripts, analytics or images from anywhere.
  ============================================================================
-->
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 30px 20px 64px; background: #05070f; color: #e8ecf6;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  main { max-width: 760px; margin: 0 auto; }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
  .mark { width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(135deg, hsl(217 100% 60%), hsl(265 90% 62%)); }
  .brand span { font-weight: 700; letter-spacing: -0.01em; }
  h1 { font-size: 1.55rem; letter-spacing: -0.01em; margin: 0 0 6px; }
  h2 { font-size: 1.06rem; margin: 34px 0 10px; color: #fff; }
  h3 { font-size: 0.97rem; margin: 22px 0 6px; color: #fff; }
  p, li { color: #c9d2e4; }
  li { margin: 4px 0; }
  a { color: hsl(217 100% 72%); }
  .meta { color: #8b97ae; font-size: 0.86rem; margin: 0 0 2px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0 4px; font-size: 0.93rem; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid #1b2438; vertical-align: top; }
  th { color: #8b97ae; font-weight: 600; }
  .toc { background: #0c1120; border: 1px solid #1b2438; border-radius: 14px; padding: 14px 18px; margin: 20px 0 8px; }
  .toc ol { margin: 6px 0 0; padding-left: 22px; }
  .note { background: #0c1120; border: 1px solid #1b2438; border-left: 3px solid hsl(217 100% 60%); border-radius: 12px; padding: 14px 18px; margin: 18px 0; }
  .note strong { color: #fff; }
  .nav { margin-top: 40px; padding-top: 18px; border-top: 1px solid #1b2438; font-size: 0.92rem; }
</style>
</head>
<body>
<main>
  <div class="brand"><div class="mark"></div><span>Vaylo Sports</span></div>

  <h1>Privacy Policy</h1>
  <p class="meta">Version 1.0 &middot; Effective 28 September 2026</p>
  <p class="meta">Data controller: REPLACE_ME &middot; Contact: <a href="mailto:REPLACE_ME">REPLACE_ME</a></p>

  <p>
    Vaylo Sports is a training app for athletes. This policy explains what personal
    data the app collects, why, who else processes it, and how you get it back or
    get rid of it. It covers the Vaylo Sports Android app and any web version of it.
  </p>

  <div class="note">
    <strong>The short version.</strong> We collect what the app needs to coach you:
    your account details, the training you log, health and fitness data you choose
    to connect, and the content you post. Two things are worth calling out because
    they involve sending data to someone else — AI features send the relevant text
    or video to OpenAI or Google to generate a response, and a connected wearable's
    data is read from that provider with your permission. We do not sell your data,
    we do not use health data for advertising, and you can delete everything from
    inside the app.
  </div>

  <div class="toc">
    <strong>Sections</strong>
    <ol>
      <li><a href="#collect">What we collect</a></li>
      <li><a href="#health">Health and fitness data</a></li>
      <li><a href="#ai">AI features and what leaves the app</a></li>
      <li><a href="#why">Why we use it, and our legal bases</a></li>
      <li><a href="#share">Who else processes it</a></li>
      <li><a href="#partners">Sponsorship partners</a></li>
      <li><a href="#children">Children and age</a></li>
      <li><a href="#keep">How long we keep it</a></li>
      <li><a href="#rights">Your rights and choices</a></li>
      <li><a href="#delete">Deleting your account</a></li>
      <li><a href="#security">Security</a></li>
      <li><a href="#transfers">Where your data is stored</a></li>
      <li><a href="#changes">Changes to this policy</a></li>
    </ol>
  </div>

  <h2 id="collect">1. What we collect</h2>

  <h3>Account details</h3>
  <p>
    Your email address and password (we never see the password — it is hashed by our
    authentication provider). Optionally: your name, date of birth, country, height,
    weight, sport, experience level and training goals. If you sign in with a passkey,
    we store the public key credential, never a biometric — your fingerprint or face
    never leaves your device.
  </p>

  <h3>Training and activity</h3>
  <p>
    Sessions you log or track, plus everything derived from them: training load,
    personal bests, streaks, points, achievements, readiness and recovery scores.
    Workouts you track with GPS include the route and its start and end points.
  </p>

  <h3>Content you create</h3>
  <p>
    Posts, comments, challenges, community messages, direct messages, your profile
    photo and avatar, and anything you share publicly. Public content is visible to
    other athletes — that is the point of it — so treat it as public.
  </p>

  <h3>Purchases</h3>
  <p>
    Your coin and credit balance, what you bought, and subscription status. Payment
    for Android purchases is handled entirely by Google Play; we receive a purchase
    token and a receipt, never your card number, and we do not store your billing
    address.
  </p>

  <h3>Technical data</h3>
  <p>
    Standard server logs (IP address, request time, user agent, error details) that
    our hosting provider records to keep the service running and to stop abuse. We do
    not run third-party advertising or cross-app tracking SDKs, and there is no
    advertising identifier in this app.
  </p>

  <h2 id="health">2. Health and fitness data</h2>
  <p>
    Health data only comes from a source you explicitly connect. There is no
    background collection and no path where it arrives without your action.
  </p>
  <table>
    <tr><th>Source</th><th>What we read</th></tr>
    <tr>
      <td>Health Connect (Android)</td>
      <td>Exercise sessions, distance, total calories burned, heart rate, steps and sleep. Read-only: the app never writes to Health Connect.</td>
    </tr>
    <tr>
      <td>Connected wearable services<br /><span class="meta">Strava, Garmin, Fitbit, Oura, WHOOP, Polar, Suunto, COROS and others</span></td>
      <td>Activities, workouts and, where the provider offers it, recovery and sleep data. You authorise each one through that provider's own consent screen and can revoke it there at any time.</td>
    </tr>
    <tr>
      <td>Your device sensors</td>
      <td>
        While you have a workout actively tracking, the app reads your device
        location to measure how far you have gone. It calculates the distance on
        your device and stores only the resulting distance — your coordinates and
        the route are never saved, and location is never read in the background.
        Your country for leaderboards is a value you pick, not something derived
        from location.
      </td>
    </tr>
    <tr>
      <td>You, directly</td>
      <td>Anything you type or record: RPE, injuries, soreness, mood, nutrition, hydration.</td>
    </tr>
  </table>
  <p>
    Health and fitness data is used to build your training views, calculate load and
    recovery, and generate coaching output. It is <strong>not used for advertising or
    marketing</strong> and is <strong>never sold</strong>.
  </p>
  <p>
    To revoke Health Connect access, open the Health Connect app (or Settings &rarr;
    Security and privacy &rarr; Privacy controls &rarr; Health Connect) and remove
    permissions for Vaylo Sports. Deleting a connection in the app stops future
    syncing but does not remove data already synced — see
    <a href="#delete">Deleting your account</a> for that.
  </p>

  <h2 id="ai">3. AI features and what leaves the app</h2>
  <p>
    Coaching features are generated by large language models. When you use one, the
    text you submit and the minimum context needed to answer it is sent to the
    provider below. This is the only time your content leaves our own systems.
  </p>
  <table>
    <tr><th>Feature</th><th>What is sent</th><th>Processed by</th></tr>
    <tr>
      <td>Coach chat, training plans, weekly review, learning recommendations</td>
      <td>Your message plus a summary of your profile and recent training (sport, level, goals, logged sessions, injuries you recorded) so the advice fits you.</td>
      <td>OpenAI</td>
    </tr>
    <tr>
      <td>Video form analysis</td>
      <td>You upload a video, which is sent in full (up to roughly 18&nbsp;MB) along with your sport and relevant profile context.</td>
      <td>Google (Gemini API)</td>
    </tr>
  </table>
  <p>
    Do not put information into these features that you are not willing to have
    processed this way. Both providers are used under their API terms rather than
    their consumer terms, and we grant them no permission to use your content for
    advertising.
  </p>

  <h2 id="why">4. Why we use it, and our legal bases</h2>
  <ul>
    <li><strong>To run the service you asked for</strong> — your account, your training data, your coaching output. Legal basis: performing our contract with you.</li>
    <li><strong>To process health and fitness data</strong> — with your explicit consent, which you give when you connect Health Connect or a wearable and can withdraw at any time. Legal basis: explicit consent.</li>
    <li><strong>To keep the service safe and working</strong> — abuse prevention, rate limiting, fraud and refund handling, fixing crashes. Legal basis: our legitimate interests, and our legal obligations where purchases are involved.</li>
    <li><strong>To tell you about the app</strong> — service emails such as sign-in and security notices, and notifications you opt into. Legal basis: the contract, or your consent for optional notifications.</li>
  </ul>
  <p>
    We do not profile you for advertising, and we do not make automated decisions
    with legal effects about you.
  </p>

  <h2 id="share">5. Who else processes it</h2>
  <p>
    These providers process data on our behalf and are bound by contract to use it
    only for the purposes below. This is the complete list.
  </p>
  <table>
    <tr><th>Provider</th><th>Purpose and data</th></tr>
    <tr><td>Supabase</td><td>Database, authentication, file storage and the server functions that generate your content. All data you create lives here.</td></tr>
    <tr><td>OpenAI</td><td>Generating coaching text, as described in section 3.</td></tr>
    <tr><td>Google</td><td>Play Billing for purchases; the Gemini API for video form analysis; Health Connect on your device.</td></tr>
    <tr><td>Wearable providers you connect</td><td>Reading your activities from them, with the access you granted on their own consent screen.</td></tr>
  </table>
  <p>
    We also disclose data when the law requires it, or where it is necessary to
    establish or defend a legal claim, and to a buyer if the service is ever
    transferred — in which case we will tell you first.
  </p>

  <h2 id="partners">6. Sponsorship partners</h2>
  <p>
    Sponsored content is shown only to athletes aged 18 or over and is always
    labelled. Brand partners receive <strong>aggregate</strong> campaign reporting
    only — counts of how many times a placement was shown or tapped, per campaign
    per day. They <strong>do not</strong> receive your name, contact details,
    location, training data, health data or any identifier that could single you out.
  </p>

  <h2 id="children">7. Children and age</h2>
  <p>
    Vaylo Sports is not intended for children under 13, and we do not knowingly
    collect personal data from them. If you are under 13, do not use the app.
  </p>
  <p>
    If you are under 18, sponsored content is suppressed across the app, training
    loads are adjusted for youth athletes, and no data of yours is included in the
    aggregate reporting described above. If you believe a child under 13 has created
    an account, contact <a href="mailto:REPLACE_ME">REPLACE_ME</a>
    and we will delete it.
  </p>

  <h2 id="keep">8. How long we keep it</h2>
  <ul>
    <li><strong>Your account and everything in it</strong> — until you delete it.</li>
    <li><strong>Server logs</strong> — a short, rolling window measured in days to weeks, then discarded.</li>
    <li><strong>Purchase and refund records</strong> — kept as long as tax and accounting law requires, separate from your profile.</li>
    <li><strong>One deletion record</strong> — when you delete your account we keep a single row proving the deletion happened. It contains a salted hash of your user id, a status and a timestamp. No name, no email, nothing that identifies you.</li>
  </ul>

  <h2 id="rights">9. Your rights and choices</h2>
  <p>
    Wherever you live, we extend these to you, and we do not charge for them:
  </p>
  <ul>
    <li><strong>Access</strong> — see what we hold about you throughout your profile, training history and settings.</li>
    <li><strong>Correction</strong> — edit your profile and training entries directly in the app.</li>
    <li><strong>Deletion</strong> — delete your account and its data in the app, at any time, without asking us.</li>
    <li><strong>Portability</strong> — ask us for a machine-readable copy of your data.</li>
    <li><strong>Withdraw consent</strong> — disconnect Health Connect or any wearable, or turn off notifications, at any time. Withdrawal does not undo processing that already happened.</li>
    <li><strong>Object or restrict</strong> — contact us and we will assess it. You can also complain to your local data protection authority; if you are in the EU or UK, you may complain to the authority in the country where you live.</li>
  </ul>
  <p>
    Write to <a href="mailto:REPLACE_ME">REPLACE_ME</a> for anything in
    this section. We respond within 30 days.
  </p>

  <h2 id="delete">10. Deleting your account</h2>
  <div class="note">
    <strong>In the app:</strong> Profile &rarr; Settings &rarr; Delete Account, or
    <a href="account-deletion.html">follow these steps</a>.
  </div>
  <p>
    Deletion is immediate and complete. We erase your profile, training history,
    health data, content, messages, purchases and uploaded files, and remove the
    login itself. The app then verifies the wipe by counting rows in every table
    that can hold your data and confirms nothing remains. You do not need to email
    us, and there is no waiting period.
  </p>

  <h2 id="security">11. Security</h2>
  <p>
    Data is encrypted in transit with TLS. Access to your records is enforced per-row
    in the database, not just in the app, so one athlete's data cannot be read by
    another. Passwords are stored hashed. Administrative access to production is
    restricted, and the server verifies every purchase with Google before granting
    anything.
  </p>
  <p>
    No system is perfect. If a breach affects your personal data, we will notify you
    and the relevant authority as required by law.
  </p>

  <h2 id="transfers">12. Where your data is stored</h2>
  <p>
    Our database and servers are hosted by Supabase, and AI requests are processed by
    OpenAI and Google. These providers operate infrastructure in several regions,
    including the United States, so your data may be processed outside the country
    you live in. Where data leaves the UK, EU or Switzerland, the transfer relies on
    the providers' standard contractual clauses and equivalent safeguards.
  </p>

  <h2 id="changes">13. Changes to this policy</h2>
  <p>
    If we make a material change we will tell you in the app before it takes effect
    and update the version and date at the top of this page. Continuing to use Vaylo
    Sports after that means you accept the new version.
  </p>

  <div class="nav">
    Questions about this policy or your data:
    <a href="mailto:REPLACE_ME">REPLACE_ME</a>.
    <br />
    <a href="terms.html">Terms of Service</a> &middot;
    <a href="account-deletion.html">Delete your account</a> &middot;
    <a href="health-rationale.html">Health Connect permissions</a>
  </div>
</main>
</body>
</html>
`,
  },
  "terms": {
    title: "Terms of Service",
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Terms of Service — Vaylo Sports</title>
<!--
  Operator details are tokens resolved at publish time — see the note in
  privacy.html and supabase/functions/legal/. Self-contained by design: this is
  the in-app "Terms" link, so no fonts, scripts or images from anywhere.
-->
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 30px 20px 64px; background: #05070f; color: #e8ecf6;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  main { max-width: 760px; margin: 0 auto; }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
  .mark { width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(135deg, hsl(217 100% 60%), hsl(265 90% 62%)); }
  .brand span { font-weight: 700; letter-spacing: -0.01em; }
  h1 { font-size: 1.55rem; letter-spacing: -0.01em; margin: 0 0 6px; }
  h2 { font-size: 1.06rem; margin: 34px 0 10px; color: #fff; }
  p, li { color: #c9d2e4; }
  li { margin: 4px 0; }
  a { color: hsl(217 100% 72%); }
  .meta { color: #8b97ae; font-size: 0.86rem; margin: 0 0 2px; }
  .note { background: #0c1120; border: 1px solid #1b2438; border-left: 3px solid hsl(217 100% 60%); border-radius: 12px; padding: 14px 18px; margin: 18px 0; }
  .warn { background: #241d0c; border: 1px solid #4a3a12; border-left: 3px solid #f0b429; border-radius: 12px; padding: 14px 18px; margin: 18px 0; }
  .note strong, .warn strong { color: #fff; }
  .nav { margin-top: 40px; padding-top: 18px; border-top: 1px solid #1b2438; font-size: 0.92rem; }
</style>
</head>
<body>
<main>
  <div class="brand"><div class="mark"></div><span>Vaylo Sports</span></div>

  <h1>Terms of Service</h1>
  <p class="meta">Version 1.0 &middot; Effective 28 September 2026</p>
  <p class="meta">Operator: REPLACE_ME &middot; Contact: <a href="mailto:REPLACE_ME">REPLACE_ME</a></p>

  <p>
    These terms are the agreement between you and REPLACE_ME for the Vaylo
    Sports app. By creating an account you accept them. If you do not accept them,
    do not use the app.
  </p>

  <h2>1. Who can use Vaylo Sports</h2>
  <p>
    You must be at least 13 years old. If you are under 18, you may only use the app
    with the involvement of a parent or guardian, and you should not make purchases
    without their permission. Do not use the app if you have been previously removed
    from it or if the law where you live does not allow it.
  </p>

  <h2>2. Your account</h2>
  <p>
    Keep your password and passkeys to yourself — you are responsible for what
    happens under your account. Give accurate details, especially your date of birth,
    because the app uses it to cap training loads for younger athletes and to keep
    sponsored content away from under-18s. One person, one account.
  </p>

  <h2>3. Not medical advice</h2>
  <div class="warn">
    <strong>Vaylo Sports is not a doctor, physiotherapist or dietitian.</strong>
    Training plans, recovery scores, readiness guidance, nutrition suggestions and AI
    coaching are general fitness information, generated partly by automated systems.
    They can be wrong and they are not tailored to your medical circumstances.
    Consult a qualified professional before starting or changing a training
    programme, and stop immediately if you feel pain, dizziness or discomfort. If you
    think you have a medical emergency, contact emergency services.
  </div>
  <p>
    You are responsible for the decisions you make about your own training, and you
    take part in physical activity at your own risk.
  </p>

  <h2>4. Using the app fairly</h2>
  <p>You agree not to:</p>
  <ul>
    <li>Harass, threaten or impersonate anyone, or post hateful, sexual, violent or illegal content.</li>
    <li>Upload content you do not have the right to share, or that infringes anyone's rights.</li>
    <li>Cheat: fake workouts or activity data, manipulate leaderboards, points, streaks, credits or coins, or exploit a bug instead of reporting it.</li>
    <li>Reverse engineer, scrape, resell or attempt to access the service or other athletes' data without permission, or probe our systems for vulnerabilities without our written consent.</li>
    <li>Use automated means to create accounts or generate activity, or evade a ban or a usage limit.</li>
  </ul>
  <p>
    We may remove content or suspend an account that breaks these rules. If we
    suspend your account for breaking them, you are not entitled to a refund of
    credits, coins or subscription time.
  </p>

  <h2>5. Credits, coins and Event Packs</h2>
  <p>
    Credits, coins and Event Packs are <strong>virtual items with no cash value</strong>.
    They are not money, they are not your property, they cannot be sold, transferred
    or redeemed for cash, and they exist only as a licence to use features inside
    Vaylo Sports. They do not expire while your account is open, but they are lost
    when you delete your account.
  </p>
  <ul>
    <li>Credits are spent on AI coaching and analysis, and on Event Packs. Each feature shows its cost before you confirm.</li>
    <li>Coins are earned through activity and spent on cosmetic items.</li>
    <li>Event Packs give access to the events described on their page for the period stated there.</li>
    <li>An Event Pack buys access to that event. It is not a subscription and it does not renew.</li>
  </ul>

  <h2>6. Subscriptions</h2>
  <p>
    Paid plans renew automatically at the interval shown at checkout, at the price
    displayed there, until you cancel. On Android, the subscription is managed by
    Google Play: cancel in the Play Store under <em>Payments &amp; subscriptions</em>,
    and cancelling stops the next renewal while letting the current period run out.
    Deleting the app does not cancel a subscription.
  </p>
  <p>
    If you cancel, you keep the plan until the paid period ends. We may change
    subscription prices; we will tell you before a change applies to you, and you can
    cancel first.
  </p>

  <h2>7. Buying and refunds</h2>
  <p>
    Purchases on Android are processed by Google Play, and Google's payment terms and
    refund policy apply. We never see or store your card details.
  </p>
  <p>
    Because credits, coins and Event Packs are consumed inside the app, they are not
    refundable once spent, except where the law gives you a right to a refund or
    where we failed to deliver what you paid for. Nothing in these terms removes a
    statutory right you have as a consumer. If a purchase goes wrong, contact
    <a href="mailto:REPLACE_ME">REPLACE_ME</a> and we will sort it out.
  </p>
  <p>
    We verify every purchase with Google's servers before granting anything. If a
    purchase is charged back, reversed or found to be fraudulent, the credits, coins
    or access it granted will be removed.
  </p>

  <h2>8. Sponsored content</h2>
  <p>
    Sponsor placements are labelled, are shown only to athletes aged 18 and over, and
    are subject to our own review, but we do not endorse a partner's products and are
    not responsible for them. Any dealings you have with a sponsor are between you
    and that sponsor.
  </p>

  <h2>9. Your content</h2>
  <p>
    You keep ownership of what you post. You give us a worldwide, non-exclusive,
    royalty-free licence to host, store, display and distribute it — only so we can
    run and improve the app, including letting other athletes see the content you
    choose to make public, and only for as long as you keep it in the app. Delete it
    and the licence for it ends, apart from copies already made by others or retained
    in backups for a short period.
  </p>
  <p>
    You confirm you have the rights needed to post what you post. We may remove
    content that breaks these terms or the law.
  </p>

  <h2>10. AI features</h2>
  <p>
    AI-generated output is generated on demand and can be inaccurate, incomplete or
    unsuitable for you. It does not replace professional judgement. Do not rely on it
    for medical, legal or financial decisions.
  </p>

  <h2>11. Our content</h2>
  <p>
    The app itself — its design, code, text, branding, learning content and graphics
    — belongs to us or our licensors, and these terms only give you a personal,
    non-transferable licence to use the app on your own devices. Do not copy it or
    present it as your own.
  </p>

  <h2>12. Availability and changes</h2>
  <p>
    We improve and change the app, so features may be added, altered or removed. We
    aim to keep the service available but we do not promise uninterrupted access —
    maintenance, outages and third-party failures happen. We may suspend or end the
    service; if we end it permanently, we will give reasonable notice and refund
    unused subscription time.
  </p>

  <h2>13. Ending the agreement</h2>
  <p>
    You can stop at any time by
    <a href="account-deletion.html">deleting your account</a>. We may suspend or
    close your account if you materially break these terms, if we are required to by
    law, or if we discontinue the service. Sections that by their nature should
    survive — ownership, disclaimers, liability limits and governs law — survive
    termination.
  </p>

  <h2>14. Disclaimers and liability</h2>
  <p>
    Except for what is stated in these terms, the app is provided "as is" without
    warranties, to the extent the law allows. We do not warrant that the app will be
    error-free or that AI output will be accurate.
  </p>
  <p>
    To the fullest extent permitted by law, we are not liable for indirect or
    consequential losses, loss of data caused by something outside our control, or
    loss of profits or goodwill. Where we are liable, our total liability is limited
    to the greater of the amount you paid us in the twelve months before the claim,
    or the equivalent of about fifty euros.
  </p>
  <p>
    Nothing here limits liability that cannot lawfully be limited — including for
    death or personal injury caused by negligence, or for fraud — and nothing here
    affects your statutory consumer rights, which always take precedence over this
    section.
  </p>

  <h2>15. Governing law</h2>
  <p>
    These terms are governed by the laws of the country in which REPLACE_ME is
    established, and disputes may be brought before its courts. If you are a consumer
    resident elsewhere, you also keep the protection of the mandatory consumer law of
    your own country of residence and may bring proceedings there.
  </p>

  <h2>16. Changes to these terms</h2>
  <p>
    We may update these terms. If a change is material we will tell you in the app
    before it takes effect and update the version and date above. Continuing to use
    the app after that means you accept the updated terms.
  </p>

  <h2>17. Contact</h2>
  <p>
    <a href="mailto:REPLACE_ME">REPLACE_ME</a>
  </p>

  <div class="nav">
    <a href="privacy.html">Privacy Policy</a> &middot;
    <a href="account-deletion.html">Delete your account</a> &middot;
    <a href="health-rationale.html">Health Connect permissions</a>
  </div>
</main>
</body>
</html>
`,
  },
  "account-deletion": {
    title: "Delete your account",
    html: `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>Delete your account — Vaylo Sports</title>
<!--
  Play requires a deletion route that works for someone who no longer has the app
  installed, so this page carries an email path as well as the in-app steps. It is
  also the URL entered in Play Console under "Data deletion".
-->
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 30px 20px 64px; background: #05070f; color: #e8ecf6;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  main { max-width: 720px; margin: 0 auto; }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 20px; }
  .mark { width: 34px; height: 34px; border-radius: 10px; background: linear-gradient(135deg, hsl(217 100% 60%), hsl(265 90% 62%)); }
  .brand span { font-weight: 700; letter-spacing: -0.01em; }
  h1 { font-size: 1.55rem; letter-spacing: -0.01em; margin: 0 0 6px; }
  h2 { font-size: 1.06rem; margin: 32px 0 10px; color: #fff; }
  p, li { color: #c9d2e4; }
  ol, ul { padding-left: 22px; }
  li { margin: 6px 0; }
  a { color: hsl(217 100% 72%); }
  .meta { color: #8b97ae; font-size: 0.86rem; margin: 0 0 2px; }
  .card { background: #0c1120; border: 1px solid #1b2438; border-radius: 14px; padding: 16px 20px; margin: 18px 0; }
  .card h2 { margin-top: 0; }
  .cta {
    display: inline-block; margin: 6px 0 0; padding: 13px 18px; border-radius: 12px;
    background: hsl(217 100% 60%); color: #05070f; font-weight: 700; text-decoration: none;
  }
  .kept { background: #0c1120; border: 1px solid #1b2438; border-left: 3px solid #f0b429; border-radius: 12px; padding: 14px 18px; margin: 18px 0; }
  .kept strong { color: #fff; }
  .nav { margin-top: 40px; padding-top: 18px; border-top: 1px solid #1b2438; font-size: 0.92rem; }
</style>
</head>
<body>
<main>
  <div class="brand"><div class="mark"></div><span>Vaylo Sports</span></div>

  <h1>Delete your account</h1>
  <p class="meta">Last updated 28 September 2026</p>
  <p class="meta">Vaylo Sports is operated by REPLACE_ME. Contact: <a href="mailto:REPLACE_ME">REPLACE_ME</a></p>

  <p>
    You can delete your Vaylo Sports account and all of its data yourself, at any
    time. There is no waiting period, no charge, and you do not need to contact us.
  </p>

  <div class="card">
    <h2>If you still have the app</h2>
    <ol>
      <li>Open Vaylo Sports and sign in.</li>
      <li>Go to the <strong>Profile</strong> tab.</li>
      <li>Tap <strong>Settings</strong> to expand it, then <strong>Delete Account</strong>. The same button also sits under Sign Out.</li>
      <li>Confirm. Deletion runs immediately.</li>
    </ol>
    <p style="margin-bottom:0">
      The app then verifies the deletion by checking every table that can hold your
      data and tells you whether it completed. If anything could not be removed you
      will see it reported rather than a false success.
    </p>
  </div>

  <div class="card">
    <h2>If you no longer have the app</h2>
    <p>
      Email us from the address on the account, or tell us the account's email
      address, and ask for deletion. We will action it and confirm within 30 days,
      usually much sooner.
    </p>
    <a class="cta" href="mailto:REPLACE_ME?subject=Delete%20my%20Vaylo%20Sports%20account">Email REPLACE_ME</a>
  </div>

  <h2>What gets deleted</h2>
  <p>Deleting your account removes:</p>
  <ul>
    <li>Your profile, name, date of birth, country, height, weight and preferences</li>
    <li>All training and activity history, including distances measured by GPS</li>
    <li>Health and fitness data synced from Health Connect or a connected wearable</li>
    <li>Coaching conversations, generated plans and video form analyses</li>
    <li>Posts, comments, messages, challenges, community membership and your profile photo</li>
    <li>Credits, coins, Event Pack access, achievement and points history</li>
    <li>Your login itself, so the account can never be signed into again</li>
  </ul>

  <div class="kept">
    <strong>What is kept, and why.</strong>
    <ul style="margin-bottom:0">
      <li>
        <strong>Purchase and refund records</strong> that tax and accounting law
        requires us to retain. These are held separately from your profile and are
        not used for anything else.
      </li>
      <li>
        <strong>One anonymous deletion record</strong> — a salted hash of your user
        id, a status and a timestamp. It contains no name, no email and nothing that
        identifies you; it exists only to prove the deletion happened. You can read
        the same statement in
        <a href="privacy.html#keep">the privacy policy</a>.
      </li>
    </ul>
  </div>

  <h2>Before you delete</h2>
  <p>
    Deletion cannot be undone. If you have an active subscription, cancel it in the
    Play Store under <em>Payments &amp; subscriptions</em> — deleting your Vaylo
    Sports account does not cancel a Google Play subscription. Unspent credits and
    coins are lost, and if you want a copy of your data, ask us first.
  </p>

  <div class="nav">
    <a href="privacy.html">Privacy Policy</a> &middot;
    <a href="terms.html">Terms of Service</a> &middot;
    <a href="health-rationale.html">Health Connect permissions</a>
  </div>
</main>
</body>
</html>
`,
  },
};
