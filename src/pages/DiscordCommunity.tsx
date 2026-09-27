import { MessageCircle, Users, Trophy, Zap, ArrowRight, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { openExternal } from "@/lib/platform";
import { discordInviteUrl, DISCORD_PAGE_PATH } from "@/config/community";

/**
 * Public community page (/discord) — the shareable home for the Vaylo Sports Discord.
 *
 * With VITE_DISCORD_INVITE_URL set, the whole page drives one action: join the
 * server. Without it, the page still works as a "coming soon" surface so links
 * never 404 while the server is being set up. No app chrome: shared from
 * inside or outside the app, it has to sell the community on its own.
 */
const DiscordCommunity = () => {
  const { session } = useAuth();
  const invite = discordInviteUrl();

  const join = () => {
    if (invite) void openExternal(invite);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-12 pb-10 max-w-lg mx-auto text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-electric-purple to-energy">
          <MessageCircle className="h-8 w-8 text-white" />
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-energy">Vaylo Sports</p>
        <h1 className="mt-1 text-3xl font-display font-bold">The locker room</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Train with the community on Discord — race day threads, PB celebrations, form-check
          feedback and direct access to the team building Vaylo Sports.
        </p>

        {invite ? (
          <button
            onClick={join}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#5865F2] py-3.5 text-base font-bold text-white transition-opacity hover:opacity-90"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M20.317 4.37a19.79 19.79 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.099.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
            Join the Discord
          </button>
        ) : (
          <div className="mt-6 rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
            The server is warming up — entry points appear automatically once the invite is
            configured. Check back soon.
          </div>
        )}

        <div className="mt-6 space-y-2 text-left">
          {[
            { icon: Trophy, text: "Weekly challenge threads and winner spotlights" },
            { icon: Zap, text: "PB celebrations — every milestone gets a cheer" },
            { icon: Users, text: "Find training partners for your sport" },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
              <Icon size={16} className="shrink-0 text-energy" />
              <span className="text-sm">{text}</span>
              <Check size={14} className="ml-auto shrink-0 text-muted-foreground" />
            </div>
          ))}
        </div>

        {!session && (
          <a
            href="/auth"
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-energy/40 py-3 text-sm font-semibold text-energy"
          >
            Create your free Vaylo Sports account <ArrowRight size={14} />
          </a>
        )}

        <p className="mt-6 text-[11px] text-muted-foreground">
          Share this page: {DISCORD_PAGE_PATH} — free to join, no Vaylo Sports account needed for Discord.
        </p>
      </div>
    </div>
  );
};

export default DiscordCommunity;
