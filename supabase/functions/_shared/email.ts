// ============================================================================
// email — sending waiting-list mail through the operator's own Gmail account
// ----------------------------------------------------------------------------
// Why SMTP and why Gmail, rather than an email API.
//
// Every hosted email API (Resend, SendGrid, Plunk, Postmark) requires a sending
// domain you own and can add DKIM/SPF records to. This project has no owned
// domain — the site is a netlify.app subdomain — so none of them can be used.
// The remaining option, sending "from" a gmail.com address through a third-party
// API, does not work either: gmail.com publishes a strict DMARC policy, so mail
// that claims to be from it but is not sent by Google fails alignment and is
// rejected or filed as spam. The only correct way to send as a Gmail address is
// to send through Google.
//
// That means SMTP, and Supabase Edge Functions block ports 25 and 587. Port 465
// (implicit TLS) is reachable — verified in this project by a probe function that
// completed a TLS handshake and read the live greeting from smtp.gmail.com
// before this file was written. So this is a small SMTP client over
// Deno.connect/startTls rather than a dependency: the connection primitive is
// the one thing already proven to work here, and a hand-written client keeps
// the exact headers (notably List-Unsubscribe) under our control.
//
// Credentials: GMAIL_USER and GMAIL_APP_PASSWORD, set as Supabase secrets. An
// app password, never the account password — Google requires 2-Step
// Verification to be on before app passwords can be created, and revoking one
// does not change the password on the account.
// ============================================================================

const HOSTNAME = "smtp.gmail.com";
const PORT = 465;
export const FROM_NAME = "Vaylo Sports";

/** Reply read timeout. A silent server must not hang the request. */
const REPLY_TIMEOUT_MS = 20_000;

export function gmailUser(): string | null {
  const value = Deno.env.get("GMAIL_USER")?.trim();
  return value ? value : null;
}

/**
 * Google displays app passwords in four-character groups ("abcd efgh ijkl mnop").
 * The spaces are presentation only and are not part of the password, so they are
 * stripped here rather than being a support call later.
 */
export function gmailPassword(): string | null {
  const raw = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!raw) return null;
  const value = raw.replace(/\s+/g, "");
  return value ? value : null;
}

/** Whether mail can actually be sent. Callers must handle "no". */
export function emailConfigured(): boolean {
  return gmailUser() !== null && gmailPassword() !== null;
}

/* ------------------------------------------------------------------ wire -- */

interface ByteStream {
  read(buffer: Uint8Array): Promise<number | null>;
  write(data: Uint8Array): Promise<number>;
  close(): void;
}

class SmtpReader {
  private buffered = "";
  private decoder = new TextDecoder();

  constructor(private stream: ByteStream) {}

  /** One CRLF-terminated line. */
  async line(): Promise<string> {
    for (;;) {
      const index = this.buffered.indexOf("\r\n");
      if (index !== -1) {
        const line = this.buffered.slice(0, index);
        this.buffered = this.buffered.slice(index + 2);
        return line;
      }
      const chunk = new Uint8Array(4096);
      const read = await withTimeout(this.stream.read(chunk), "smtp_read_timeout");
      if (read === null || read === 0) throw new Error("smtp_connection_closed");
      this.buffered += this.decoder.decode(chunk.subarray(0, read), { stream: true });
    }
  }

  /**
   * A complete SMTP reply: continuation lines are "250-thing", the last line is
   * "250 thing". Nothing may be interpreted until that final space-form line.
   */
  async reply(): Promise<string> {
    const parts: string[] = [];
    for (;;) {
      const line = await this.line();
      parts.push(line);
      if (/^\d{3} /.test(line)) return parts.join("\n");
    }
  }
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), REPLY_TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Throws with the server's own reply text when a command is refused. */
function expect(reply: string, codes: number[]): void {
  const code = Number(reply.slice(0, 3));
  if (!codes.includes(code)) throw new Error(`smtp_${code || "unknown"}: ${reply.slice(0, 200)}`);
}

function base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Base64 for a header value that may contain non-ASCII, encoded per RFC 2047.
 * Subjects here are ASCII, but a subject is user-supplied at broadcast time and
 * a raw non-ASCII byte in a header is what turns a message into mojibake.
 */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${base64(value)}?=`;
}

/** RFC 5322 requires a leading "." in a body line to be doubled. */
function dotStuff(body: string): string {
  return body.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

/* --------------------------------------------------------------- message -- */

export interface OutgoingMail {
  to: string;
  subject: string;
  /** Plain-text part. Always sent: some clients show nothing else. */
  text: string;
  /** HTML part, optional. */
  html?: string;
  /**
   * Where one click removes the recipient. Sent both as a header (so mail
   * clients can offer their own unsubscribe control) and inside the body (so it
   * is reachable when the client does not surface the header).
   */
  unsubscribeUrl?: string;
}

function boundary(): string {
  return `vaylo-${crypto.randomUUID()}`;
}

function message(mail: OutgoingMail, from: string): string {
  const headers: string[] = [
    `From: ${FROM_NAME} <${from}>`,
    `To: ${mail.to}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    "MIME-Version: 1.0",
    "Auto-Submitted: auto-generated",
  ];

  if (mail.unsubscribeUrl) {
    // RFC 8058 one-click, plus the plain mailto form older clients understand.
    headers.push(
      `List-Unsubscribe: <${mail.unsubscribeUrl}>, <mailto:${from}?subject=unsubscribe>`,
      "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    );
  }

  if (!mail.html) {
    headers.push('Content-Type: text/plain; charset="utf-8"', "Content-Transfer-Encoding: 8bit");
    return `${headers.join("\r\n")}\r\n\r\n${mail.text}`;
  }

  const edge = boundary();
  headers.push(`Content-Type: multipart/alternative; boundary="${edge}"`);

  const parts = [
    `--${edge}`,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    mail.text,
    `--${edge}`,
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    mail.html,
    `--${edge}--`,
    "",
  ];

  return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}`;
}

/* ------------------------------------------------------------------ send -- */

/**
 * Send one message. Throws on any failure — the caller decides what a failure
 * means, and for the waiting list it means "not sent", never "assume it worked".
 */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  const user = gmailUser();
  const password = gmailPassword();
  if (!user || !password) throw new Error("email_not_configured");

  const tcp = await Deno.connect({ hostname: HOSTNAME, port: PORT });
  let stream: ByteStream = tcp;
  try {
    // Implicit TLS on 465: the socket is wrapped before a single byte is spoken.
    const tls = await Deno.startTls(tcp, { hostname: HOSTNAME });
    stream = tls;
    await speak(stream, user, password, mail, user);
  } finally {
    try {
      stream.close();
    } catch {
      // Already closed by speak()'s QUIT, or by a failure above. Either way the
      // socket is going away and there is nothing useful to do about it.
    }
  }
}

async function speak(
  stream: ByteStream,
  user: string,
  password: string,
  mail: OutgoingMail,
  from: string,
): Promise<void> {
  const reader = new SmtpReader(stream);
  const write = (line: string) => stream.write(new TextEncoder().encode(`${line}\r\n`));

  expect(await reader.reply(), [220]); // greeting
  await write(`EHLO ${HOSTNAME}`);
  expect(await reader.reply(), [250]);

  await write("AUTH LOGIN");
  expect(await reader.reply(), [334]);
  await write(base64(user));
  expect(await reader.reply(), [334]);
  await write(base64(password));
  expect(await reader.reply(), [235]);

  await write(`MAIL FROM:<${from}>`);
  expect(await reader.reply(), [250]);
  await write(`RCPT TO:<${mail.to}>`);
  expect(await reader.reply(), [250, 251]);
  await write("DATA");
  expect(await reader.reply(), [354]);

  await stream.write(new TextEncoder().encode(`${dotStuff(message(mail, from))}\r\n.\r\n`));
  expect(await reader.reply(), [250]);

  await write("QUIT");
  // Some servers close before answering QUIT; that is not a send failure.
  try {
    await reader.reply();
  } catch {
    // ignore
  }
}

/* --------------------------------------------------------------- content -- */

export interface WaitlistRow {
  email: string;
  display_name: string | null;
  unsubscribe_token: string;
}

/**
 * Where the unsubscribe link points.
 *
 * The confirm endpoint itself, and the GET on the other end only *renders* a
 * button — the removal is a POST. That split is the important part: mail
 * clients and security scanners fetch the links in a message before a human
 * sees them, so a GET that unsubscribed would silently remove people who never
 * clicked anything.
 *
 * This used to build a URL on SITE_URL instead, pointing at /unsubscribe/ on
 * the marketing site. Both halves of that were wrong and neither was noticed
 * until the secrets audit: SITE_URL is not set for this project at all, so the
 * function returned an empty string and every confirmation went out reading
 * "(no unsubscribe link configured)"; and no /unsubscribe/ page has ever been
 * generated, so even with the variable set the link would have 404'd. Building
 * it from SUPABASE_URL fixes both, because that variable is always present and
 * the endpoint behind it is deployed and exercised.
 *
 * Returns "" only if the runtime has no SUPABASE_URL, which would mean the
 * function is not running in Supabase at all.
 */
export function unsubscribeUrl(token: string): string {
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/functions/v1/waitlist-unsubscribe?token=${encodeURIComponent(token)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The message someone gets the moment they join.
 *
 * It says what is true: the address was stored, what it will be used for, the
 * launch date the countdown is built around, and how to leave. It does not
 * promise a position, a queue, or that this message is a purchase — because
 * none of those exist.
 */
export function confirmationMail(row: WaitlistRow): OutgoingMail {
  const name = row.display_name?.trim();
  const greeting = name ? `Hello ${name},` : "Hello,";
  const link = unsubscribeUrl(row.unsubscribe_token);

  const text = [
    greeting,
    "",
    "You are on the Vaylo Sports waiting list. Your email address has been",
    "stored, and this message is the only thing that has been sent to you so far.",
    "",
    "What happens next: the Android release opens on the Google Play Store on",
    "1 January 2027. This address will get a short run of updates as that date",
    "approaches, and the link on launch day. That is the one thing it is used for.",
    "",
    "If that date moves, you will be told that too. Nothing is needed from you",
    "now, and nothing here is a purchase.",
    "",
    "You can leave the list at any time, and the link below stops any further",
    "email immediately:",
    link || "(no unsubscribe link configured)",
    "",
    "It is not sold, rented or shared with advertisers, and it is not added to",
    "any other list, because there are no other lists.",
    "",
    "Vaylo Sports",
    "vaylosportssupport@gmail.com",
  ].join("\n");

  const html = `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.55;color:#12172a">
  <p>${escapeHtml(greeting)}</p>
  <p>You are on the <strong>Vaylo Sports</strong> waiting list. Your email address
  has been stored, and this message is the only thing that has been sent to you so far.</p>
  <p><strong>What happens next:</strong> the Android release opens on the Google Play
  Store on <strong>1 January 2027</strong>. This address will get a short run of
  updates as that date approaches, and the link on launch day. That is the one thing
  it is used for.</p>
  <p>If that date moves, you will be told that too. Nothing is needed from you now,
  and nothing here is a purchase.</p>
  <p>You can leave the list at any time and stop any further email immediately:</p>
  <p>${link ? `<a href="${escapeHtml(link)}">Leave the waiting list</a>` : "(no unsubscribe link configured)"}</p>
  <p>It is not sold, rented or shared with advertisers, and it is not added to any
  other list, because there are no other lists.</p>
  <p style="color:#66708c;font-size:13px">Vaylo Sports &middot; vaylosportssupport@gmail.com</p>
</body></html>`;

  return {
    to: row.email,
    subject: "You are on the Vaylo Sports waiting list",
    text,
    html,
    unsubscribeUrl: link || undefined,
  };
}

/**
 * Wrap a broadcast body with the unsubscribe link and the sender identity, so a
 * launch announcement cannot be sent without a way off the list. The body is
 * supplied at send time; the footer never is.
 */
export function withFooter(html: string, text: string, token: string): { html: string; text: string; link: string } {
  const link = unsubscribeUrl(token);
  const textOut = `${text}\n\n---\nLeave the waiting list at any time: ${link || "(no unsubscribe link configured)"}\nVaylo Sports \u00b7 vaylosportssupport@gmail.com`;
  const htmlOut = `${html}
<hr style="border:none;border-top:1px solid #e2e6ef;margin:22px 0">
<p style="color:#66708c;font-size:13px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
  Leave the waiting list at any time:
  ${link ? `<a href="${escapeHtml(link)}">unsubscribe</a>` : "(no unsubscribe link configured)"}
  <br>Vaylo Sports &middot; vaylosportssupport@gmail.com
</p>`;
  return { html: htmlOut, text: textOut, link };
}
