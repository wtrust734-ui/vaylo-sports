/**
 * refundEmail — the words in a refund e-mail.
 *
 * Kept out of the request handler so the exact copy can be asserted in a test
 * without a database, and so the secure-link rule is in one place:
 *
 *   The link points at the authenticated administrator page for one case. It
 *   carries no token and no decision. Opening it authorises nothing; the page
 *   needs a signed-in admin session, and the decision is a POST the person has
 *   to make deliberately. A link forwarded to the wrong person is therefore a
 *   dead end, and a mail scanner that "clicks" every URL cannot approve a refund.
 *
 * Never included: purchase tokens, provider references, card details, admin
 * notes written after the fact, or another athlete's data.
 */

export interface RefundEmailCase {
  public_ref: string;
  kind: string;
  source_type: string;
  status: string;
  reason_code: string;
  details: string | null;
  feature: string | null;
  credits_requested: number | null;
  amount_cents: number | null;
  currency: string;
  escalation_rules: string[];
  created_at: string;
}

const SOURCE_LABELS: Record<string, string> = {
  ai_service: "AI service",
  credit_purchase: "Credit purchase",
  subscription: "Subscription",
  duplicate_charge: "Possible duplicate charge",
  unauthorized: "Possible unauthorised purchase",
  other: "Other",
};

const KIND_LABELS: Record<string, string> = {
  credits: "Credit restoration",
  money: "Money refund",
  subscription: "Subscription refund",
};

function money(amountCents: number | null, currency: string): string {
  if (amountCents == null) return "—";
  const symbol = currency.toUpperCase() === "USD" ? "$" : "";
  return `${symbol}${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

/**
 * Reads an environment variable without naming the Deno global.
 *
 * This module is imported by the app's test suite (the e-mail copy is part of
 * the contract), and `src` is type-checked with no Deno lib. Going through
 * globalThis keeps one source file valid in both runtimes; outside Deno there is
 * simply no environment and the documented fallbacks apply.
 */
function env(name: string): string {
  try {
    const deno = (globalThis as {
      Deno?: { env?: { get(key: string): string | undefined } };
    }).Deno;
    return (deno?.env?.get(name) ?? "").trim();
  } catch {
    return "";
  }
}

/** The app origin used for links. No trailing slash; never derived from a request. */
export function appOrigin(): string {
  const configured = env("PUBLIC_APP_URL").replace(/\/+$/, "");
  return configured || "https://vaylo-sports-app.netlify.app";
}

/** The address a review e-mail goes to. Configured, never invented. */
export function adminReviewRecipient(): string {
  const configured = env("REFUND_ADMIN_EMAIL");
  if (configured) return configured;
  const operator = env("OPERATOR_EMAIL");
  if (operator) return operator;
  // The operator address already used by report-error, content escalation and
  // the failed-refund alert. This is existing verified configuration, not a
  // new address made up for this feature.
  return "vaylosportssupport@gmail.com";
}

/**
 * The route the app actually serves. It is a query parameter rather than a path
 * segment on purpose: the screen is one route that reads ?case=, so the link
 * keeps working if the case list layout changes, and the value is still just a
 * reference — never a token, never a decision.
 */
export function adminReviewLink(publicRef: string): string {
  return `${appOrigin()}/admin/refunds?case=${encodeURIComponent(publicRef)}`;
}

/** No security decision lives in this URL, only the case to open. */
export function buildAdminReviewEmail(c: RefundEmailCase): { subject: string; text: string } {
  const kind = KIND_LABELS[c.kind] ?? c.kind;
  const source = SOURCE_LABELS[c.source_type] ?? c.source_type;
  const asks = c.kind === "credits"
    ? `${c.credits_requested ?? "—"} credits`
    : money(c.amount_cents, c.currency);

  const lines = [
    "Vaylo Sports — refund review needed",
    "",
    `Case:        ${c.public_ref}`,
    `Type:        ${kind} (${source})`,
    `Requested:   ${asks}`,
    c.feature ? `Feature:     ${c.feature}` : null,
    `Customer:    ${c.details ? "details supplied with the request" : "no details supplied"}`,
    `Opened:      ${c.created_at}`,
    "",
    `Reason given: ${c.reason_code}`,
    "",
  ].filter((line): line is string => line !== null);

  if (c.escalation_rules.length > 0) {
    lines.push("Why this needs a person:");
    for (const rule of c.escalation_rules) lines.push(`  - ${rule}`);
    lines.push("");
  }

  lines.push(
    "Open the case (sign-in required):",
    adminReviewLink(c.public_ref),
    "",
    "Nothing is refunded by opening that page. Approve or Reject is a separate,",
    "confirmed action, and the page shows exactly what the operation will do.",
    "",
    "If a credit restoration is approved it is written to the ledger immediately.",
    "Money movements stay 'awaiting payment provider' until a verified provider",
    "is connected — the dashboard will say so rather than claim money moved.",
    "",
    "-- Vaylo Sports refunds",
  );

  return {
    subject: `[Refund review] ${c.public_ref} — ${kind}, ${asks}`,
    text: lines.join("\n"),
  };
}

export interface CustomerUpdate {
  publicRef: string;
  status: string;
  customerMessage: string;
  /** Extra line for a decision, e.g. the administrator's reason. */
  note?: string | null;
}

export function buildCustomerEmail(update: CustomerUpdate): { subject: string; text: string } {
  const lines = [
    `Your Vaylo Sports refund request ${update.publicRef}`,
    "",
    update.customerMessage,
    "",
    `Status: ${update.status}`,
  ];
  if (update.note) {
    lines.push("", `Note from the team: ${update.note}`);
  }
  lines.push(
    "",
    "You can see the case and its history any time in the app:",
    "Profile → Purchases & refunds.",
    "",
    "Nothing in this message changes your statutory rights.",
    "",
    "-- Vaylo Sports",
  );
  return {
    subject: `Vaylo Sports refund ${update.publicRef}: ${update.status}`,
    text: lines.join("\n"),
  };
}
