// ============================================================================
// VAYLO SPORTS — COMMUNITY LINKS
// ----------------------------------------------------------------------------
// The Discord community is a growth surface, so its URL lives in env config:
// set VITE_DISCORD_INVITE_URL in .env (e.g. https://discord.gg/your-code) and
// every Discord entry point appears. No value set = buttons stay hidden and
// /discord shows a "launching soon" state — nothing can ever point at a wrong
// server. Invite codes expire, so keep the URL a permanent one
// (Server Settings → Invites → no expiry).
// ============================================================================

/** Public community page in the app (this is what gets shared / linked). */
export const DISCORD_PAGE_PATH = "/discord";

/** The invite URL from env, or null when not configured yet. */
export function discordInviteUrl(): string | null {
  const url = (import.meta.env.VITE_DISCORD_INVITE_URL as string | undefined)?.trim();
  return url ? url : null;
}
