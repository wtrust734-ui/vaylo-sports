import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Trophy, Activity, Target, ArrowLeft, Users, Lock, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import AvatarCharacter, { type AvatarLoadout } from "@/components/avatar/AvatarCharacter";
import { fetchDisplayName } from "@/lib/publicIdentity";
import { useAuth } from "@/contexts/AuthContext";
import ReportMenu from "@/components/safety/ReportMenu";
import { formatNumber, formatShortDate } from "@/i18n/format";

// ============================================================================
// VAYLO SPORTS — public athlete profile
// ----------------------------------------------------------------------------
// Reads only what the schema actually makes public:
//   avatars                 → identity + the rendered athlete
//   privacy_settings        → the athlete's own "show avatar publicly" choice
//   leaderboard_totals      → points earned (public via points_events)
//   challenge_participants  → challenge participation
//   user_profile_cosmetics  → equipped public cosmetics
// Anything private is shown as locked rather than as a zero.
//
// Cosmetic slots are public selections on `user_profile_cosmetics` (the table
// has a `FOR SELECT USING (true)` read policy). The page renders the same
// public identity layer the athlete sees on their own profile: title, name
// colour, border, background, effect and earned badge. Cosmetics change how a
// profile looks to other people; they do not change training or ranking.
// ============================================================================

interface CosmeticDefRow {
  id: string;
  name: string;
  type: string;
  payload: { label?: string; color?: string; animated?: boolean } | null;
}

interface ProfileState {
  name: string;
  /** Equipped public title cosmetic, if any. */
  titleLabel: string;
  /** Equipped name-color cosmetic, if any. */
  nameColor: string | null;
  /** Equipped public border cosmetic, if any. */
  borderColor: string | null;
  /** Equipped public background cosmetic, if any. */
  backgroundColor: string | null;
  /** Equipped public effect cosmetic, if any. */
  effectColor: string | null;
  /** Equipped public badge cosmetic, if any. */
  badgeLabel: string;
  loadout: AvatarLoadout | null;
  /** False when the athlete has asked not to be shown publicly. */
  avatarPublic: boolean;
  points: number;
  rank: number | null;
  competitors: number;
  lastActive: string | null;
  challenges: { id: string; title: string; icon: string | null; status: string }[];
  joinedChallenges: number;
  communities: number;
  error?: string;
}

const RANK_PAGE = 1000;
const RANK_MAX_PAGES = 10;

const cosmeticLabelFromRow = (row?: CosmeticDefRow | null): string => {
  if (!row) return "";
  const label = (row.payload as { label?: string } | null)?.label;
  return label ?? row.name;
};

const PublicProfile = () => {
  const { username } = useParams();
  const navigate = useNavigate();
  const { user: viewer } = useAuth();
  const [state, setState] = useState<ProfileState | null>(null);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;

    (async () => {
      const [avatarRes, privRes, partsRes, cosRes] = await Promise.all([
        supabase.from("avatars").select("*").eq("user_id", username).maybeSingle(),
        supabase.rpc("peer_privacy", { p_user: username }),
        supabase.from("challenge_participants").select("challenge_id,status").eq("user_id", username).limit(50),
        supabase.from("user_profile_cosmetics").select("title_id,border_id,background_id,name_color_id,badge_id,effect_id").eq("user_id", username).maybeSingle(),
      ]);

      // Public name: `avatars.display_name` is the only cross-user name column.
      const name = await fetchDisplayName(username);

      // Equipped cosmetics are public (`user_profile_cosmetics` and
      // `reward_definitions` are both readable), so they render here too.
      // Titles carry their display text in payload; name colours and borders
      // carry a hex value; effects may carry a colour as well.
      let titleLabel = "";
      let nameColor: string | null = null;
      let borderColor: string | null = null;
      let backgroundColor: string | null = null;
      let effectColor: string | null = null;
      let badgeLabel = "";
      const cosmeticIds = [
        cosRes?.data?.title_id,
        cosRes?.data?.border_id,
        cosRes?.data?.background_id,
        cosRes?.data?.name_color_id,
        cosRes?.data?.effect_id,
        cosRes?.data?.badge_id,
      ].filter((id): id is string => !!id);
      if (cosmeticIds.length) {
        const { data: defs } = await supabase.from("reward_definitions").select("id,name,type,payload").in("id", cosmeticIds);
        const byId = new Map<string, CosmeticDefRow>((defs ?? []).map(d => [d.id, d as CosmeticDefRow]));
        const title = cosRes?.data?.title_id ? byId.get(cosRes.data.title_id) : undefined;
        const color = cosRes?.data?.name_color_id ? byId.get(cosRes.data.name_color_id) : undefined;
        const border = cosRes?.data?.border_id ? byId.get(cosRes.data.border_id) : undefined;
        const background = cosRes?.data?.background_id ? byId.get(cosRes.data.background_id) : undefined;
        const effect = cosRes?.data?.effect_id ? byId.get(cosRes.data.effect_id) : undefined;
        const badge = cosRes?.data?.badge_id ? byId.get(cosRes.data.badge_id) : undefined;
        titleLabel = (title?.payload as { label?: string } | null)?.label ?? title?.name ?? "";
        nameColor = (color?.payload as { color?: string } | null)?.color ?? null;
        borderColor = (border?.payload as { color?: string } | null)?.color ?? null;
        backgroundColor = (background?.payload as { color?: string } | null)?.color ?? null;
        effectColor = (effect?.payload as { color?: string } | null)?.color ?? null;
        badgeLabel = cosmeticLabelFromRow(badge);
      }

      // Points come from `points_events` (publicly readable). Rank is only
      // reported when the totals were read in full, so it is never a guess.
      let points = 0;
      let rank: number | null = null;
      let competitors = 0;
      {
        const totals = new Map<string, number>();
        let complete = true;
        for (let page = 0; page < RANK_MAX_PAGES; page++) {
          const { data, error } = await supabase
            .from("leaderboard_totals")
            .select("user_id,points")
            .range(page * RANK_PAGE, page * RANK_PAGE + RANK_PAGE - 1);
          if (error) { complete = false; break; }
          const rows = data ?? [];
          rows.forEach((r: { user_id: string; points: number | null }) =>
            totals.set(r.user_id, (totals.get(r.user_id) ?? 0) + Number(r.points ?? 0)),
          );
          if (rows.length < RANK_PAGE) break;
          if (page === RANK_MAX_PAGES - 1) complete = false;
        }
        points = totals.get(username) ?? 0;
        competitors = totals.size;
        if (complete && totals.size > 0) {
          const ordered = Array.from(totals.values()).sort((a, b) => b - a);
          rank = ordered.findIndex(v => v === points) + 1 || null;
        }
      }

      // Challenge participation (public table), then the challenge rows themselves.
      const parts = partsRes?.data ?? [];
      let challenges: ProfileState["challenges"] = [];
      if (parts.length) {
        const ids = parts.map(p => p.challenge_id);
        const { data: rows } = await supabase.from("challenges").select("id,title,icon").in("id", ids);
        const byId = new Map((rows ?? []).map(c => [c.id, c]));
        challenges = parts
          .map(p => {
            const c = byId.get(p.challenge_id);
            return c ? { id: c.id, title: c.title, icon: c.icon, status: p.status } : null;
          })
          .filter((c): c is ProfileState["challenges"][number] => c !== null)
          .slice(0, 8);
      }

      const { count: communityCount } = await supabase
        .from("community_members")
        .select("community_id", { count: "exact", head: true })
        .eq("user_id", username);

      if (cancelled) return;

      const avatar = avatarRes?.data;
      setState({
        name: avatar?.display_name?.trim() || name,
        titleLabel,
        nameColor,
        borderColor,
        backgroundColor,
        effectColor,
        badgeLabel,
        loadout: avatar ? { ...((avatar.extras as Record<string, string>) || {}), ...avatar, display_name: avatar.display_name } : null,
        avatarPublic:
          (Array.isArray(privRes?.data) ? privRes.data[0] : null)?.show_avatar_publicly !== false,
        points,
        rank,
        competitors,
        lastActive: avatar?.updated_at ?? null,
        challenges,
        joinedChallenges: parts.length,
        communities: communityCount ?? 0,
        error: avatarRes?.error?.message,
      });
    })();

    return () => { cancelled = true; };
  }, [username]);

  if (!state) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading profile…</div>;
  }

  const first = state.name.charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-background pb-24">
      <button onClick={() => navigate(-1)} className="absolute top-4 left-4 z-10 p-2 rounded-xl bg-card/80 border border-border"><ArrowLeft size={18} /></button>

      <div className="bg-gradient-card border-b border-primary/20 px-5 pt-16 pb-6">
        <div className="flex items-center gap-4">
          {state.avatarPublic && state.loadout ? (
            <div className={`w-20 h-20 rounded-2xl overflow-hidden flex items-center justify-center border-2 transition-colors ${state.borderColor ? "border" : "border-primary/20"}`}
              style={state.borderColor ? { borderColor: state.borderColor } : undefined}
            >
              <AvatarCharacter loadout={state.loadout} size={110} animated={!!state.effectColor && state.effectColor !== "transparent"} showBadge={false} />
            </div>
          ) : (
            <div className={`w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold transition-colors ${state.borderColor ? "border-2" : "bg-primary/15 border border-primary/20"}`}
              style={state.borderColor ? { color: state.nameColor ?? undefined, borderColor: state.borderColor } : undefined}
            >
              {first}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-2xl font-display font-bold truncate" style={state.nameColor ? { color: state.nameColor } : undefined}>
              {state.name}
            </h1>
            {state.titleLabel && <p className="text-sm text-electric-purple font-semibold truncate">{state.titleLabel}</p>}
            {state.badgeLabel && <p className="text-[11px] uppercase tracking-wider text-amber-400 font-bold mt-0.5">{state.badgeLabel}</p>}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {state.rank && (
                <span className="text-[12px] uppercase tracking-wider bg-primary/15 text-primary px-2 py-0.5 rounded-md font-bold">
                  Rank #{state.rank}
                </span>
              )}
              <span className="text-[12px] uppercase tracking-wider bg-energy/15 text-energy px-2 py-0.5 rounded-md font-bold">
                {formatNumber(state.points)} pts
              </span>
            </div>
            {/* Public cosmetics: the same identity layer the athlete sees on their own profile, rendered for other people. */}
            {(state.nameColor || state.borderColor || state.backgroundColor || state.effectColor) && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {state.backgroundColor && (
                  <span className="h-5 w-14 rounded-md border border-white/10 overflow-hidden" style={{ background: state.backgroundColor }} />
                )}
                {state.borderColor && (
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/20" style={{ boxShadow: `inset 0 0 0 3px ${state.borderColor}` }} />
                )}
                {state.effectColor && (
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-white/5" style={{ boxShadow: `0 0 14px ${state.effectColor}` }}>
                    <Sparkles size={14} className="text-white/80" />
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="px-5 mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat icon={Activity} label="Points" value={formatNumber(state.points)} />
        <Stat icon={Trophy} label="Challenges" value={state.joinedChallenges} />
        <Stat icon={Users} label="Communities" value={state.communities} />
        <Stat icon={Target} label="Rank" value={state.rank ? `#${state.rank}` : "—"} />
      </div>

      {state.rank && state.competitors > 0 && (
        <p className="px-5 mt-2 text-[12px] text-muted-foreground">
          Ranked #{state.rank} of {formatNumber(state.competitors)} athletes by total points.
        </p>
      )}

      <div className="px-5 mt-6">
        <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider">Challenges</h3>
        <div className="space-y-2">
          {state.challenges.length === 0 && (
            <p className="text-sm text-muted-foreground">No challenge activity yet.</p>
          )}
          {state.challenges.map((c, i) => (
            <motion.div key={c.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
              className="bg-card border border-border rounded-xl p-3 flex items-center gap-3">
              <div className="text-2xl">{c.icon || "🏆"}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{c.title}</p>
                <p className="text-[12px] text-muted-foreground capitalize">{c.status}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Training numbers are private by design. Saying so is honest; showing a
          zero (what this page used to do) reads as "this athlete trains nothing". */}
      <div className="px-5 mt-6">
        <div className="bg-card border border-border rounded-xl p-3 flex items-start gap-3">
          <Lock size={14} className="text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-[12px] text-muted-foreground">
            Workouts, metrics, streaks and achievements are private. This athlete's training history isn't public.
          </p>
        </div>
      </div>

      {state.lastActive && (
        <p className="px-5 mt-4 text-[12px] text-muted-foreground text-center">
          Profile last updated {formatShortDate(new Date(state.lastActive))}
        </p>
      )}

      {/* Report and block. Google Play requires both for an app with
          user-generated content, and there was previously no way to reach the
          `user_blocks` table from the interface at all. Hidden on your own
          profile — you cannot report yourself. */}
      {username && viewer && viewer.id !== username && (
        <div className="px-5 mt-4 flex justify-center">
          <ReportMenu
            targetType="profile"
            targetId={username}
            targetLabel={`Profile: ${state.name}`}
            authorId={username}
            allowBlock
          />
        </div>
      )}
    </div>
  );
};

const Stat = ({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string | number }) => (
  <div className="bg-card border border-border rounded-xl p-3 text-center">
    <Icon size={14} className="mx-auto text-primary" />
    <p className="text-lg font-display font-bold mt-1">{value}</p>
    <p className="text-[12px] uppercase tracking-wider text-muted-foreground">{label}</p>
  </div>
);

export default PublicProfile;
