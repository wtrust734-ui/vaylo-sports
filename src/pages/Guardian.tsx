// ============================================================================
// GUARDIAN ACCESS — one screen, two roles
// ----------------------------------------------------------------------------
// A guardian is not a spectator with a login. They are the person legally
// answerable for a child's account, and the specification asks for exactly two
// things: a way to link, and a simplified, development-oriented view of how that
// child is training — with permissions enforced so they see nothing else.
//
// One screen rather than two, because the same person can be both: a 17-year-old
// with a parent, who is also an older sibling watching a younger one's training.
// Splitting this in two would have meant guessing which one you are.
//
// WHAT ENFORCES THE PERMISSIONS. Not this file.
// `guardian_athlete_overview()` in Postgres is SECURITY DEFINER, checks the link
// is active, and builds a payload containing only permitted sections, each
// already reduced — a recovery *band*, never a recovery log. Guardians hold no
// RLS policy on any athlete table, so there is no query this screen could make
// that would reveal more than that function returns. The client filters again on
// read (`parseGuardianOverview`) so a section is never rendered on trust.
//
// WHAT THE ATHLETE CAN CHANGE. The permission map and whether a link is approved.
// Both writes go through SECURITY DEFINER functions that take the athlete's id
// and check it against `auth.uid()`, so a guardian cannot widen their own access
// and a third party cannot edit someone else's link.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import Reveal from "@/components/motion/Reveal";
import { toast } from "sonner";
import {
  ShieldCheck, KeyRound, Copy, RefreshCw, AlertTriangle, HeartPulse, Users,
  Target, Compass, CalendarDays, Trophy, Activity, Loader2, Link2Off, Check,
} from "lucide-react";
import { ageFromDob } from "@/lib/age";
import {
  AGE_BAND_LABELS, GUARDIAN_LINK_STATUS_META, GUARDIAN_SUMMARY_NOTE, PERMISSION_KEYS, PERMISSION_META,
  RELATIONSHIP_LABELS, RECOVERY_BAND_LABELS, WORKLOAD_BAND_LABELS,
  daysUntil, formatGuardianCode, grantedPermissions, guardianAgeBand,
  guardianSanitizePermissions, lockedPermissions, normalizeGuardianCode,
  parseGuardianLink, parseGuardianOverview, readPermissions,
  type GuardianAthleteOverview, type GuardianLink, type GuardianOverviewResult, type PermissionKey,
} from "@/lib/guardianAccess";

type InviteRow = { id: string; code: string; expires_at: string; created_at: string };

const PERMISSION_GROUP_TITLES: Record<string, string> = {
  progress: "Progress",
  training: "Training",
  wellbeing: "Recovery & safety",
};

const Guardian = () => {
  const { user, profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [links, setLinks] = useState<GuardianLink[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [freshCode, setFreshCode] = useState<string | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [redeemInput, setRedeemInput] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [busyLink, setBusyLink] = useState<string | null>(null);
  const [overviews, setOverviews] = useState<Record<string, GuardianOverviewResult>>({});
  const [overviewsLoading, setOverviewsLoading] = useState(false);

  /** The band this athlete falls in, which is what the floors are computed from. */
  const band = useMemo(() => guardianAgeBand(profile?.date_of_birth ?? null), [profile?.date_of_birth]);
  const locked = useMemo(() => lockedPermissions(band), [band]);

  // Only the athlete's own side: the rows where they are the athlete. RLS
  // already restricts the read to rows where they are one of the two parties.
  const asAthlete = useMemo(() => links.filter(l => l.athlete_user_id === user?.id), [links, user?.id]);
  const asGuardian = useMemo(
    () => links.filter(l => l.guardian_user_id === user?.id && l.status === "active"),
    [links, user?.id],
  );
  // `set_guardian_permissions` writes one map across every link this athlete
  // owns, so the settings below are presented as one set rather than per-guardian.
  const activeGuardians = asAthlete.filter(l => l.status === "active");
  const currentPermissions = activeGuardians.length
    ? readPermissions(activeGuardians[0].permissions)
    : null;

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [linkRes, inviteRes] = await Promise.all([
      supabase.from("guardian_links").select("*").order("created_at"),
      supabase
        .from("guardian_invites")
        .select("id, code, expires_at, created_at")
        .eq("athlete_user_id", user.id)
        .is("redeemed_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false }),
    ]);
    const parsed = (linkRes.data ?? [])
      .map(parseGuardianLink)
      .filter(Boolean) as GuardianLink[];
    setLinks(parsed);
    setInvites((inviteRes.data ?? []) as InviteRow[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  /** Ask the database for each linked athlete's sanitized overview. */
  const loadOverviews = useCallback(async (athleteIds: string[]) => {
    if (!athleteIds.length) { setOverviews({}); return; }
    setOverviewsLoading(true);
    const results = await Promise.all(
      athleteIds.map(id => supabase.rpc("guardian_athlete_overview", { p_athlete: id })),
    );
    const next: Record<string, GuardianOverviewResult> = {};
    athleteIds.forEach((id, i) => {
      next[id] = parseGuardianOverview(results[i]?.data ?? null);
    });
    setOverviews(next);
    setOverviewsLoading(false);
  }, []);

  useEffect(() => {
    loadOverviews(asGuardian.map(l => l.athlete_user_id));
  }, [asGuardian, loadOverviews]);

  const createInvite = async () => {
    if (!user || creatingInvite) return;
    setCreatingInvite(true);
    try {
      const { data, error } = await supabase.rpc("create_guardian_invite");
      if (error) { toast.error(error.message); return; }
      const payload = (data ?? {}) as { code?: string };
      if (!payload.code) { toast.error("Couldn't create a code. Try again."); return; }
      setFreshCode(payload.code);
      load();
    } finally {
      setCreatingInvite(false);
    }
  };

  const redeem = async () => {
    if (!user || redeeming) return;
    const code = normalizeGuardianCode(redeemInput);
    if (code.length !== 8) {
      toast.error("That code should be 8 characters. Check it and try again.");
      return;
    }
    setRedeeming(true);
    try {
      const { data, error } = await supabase.rpc("redeem_guardian_invite", { p_code: code });
      if (error) { toast.error(error.message); return; }
      const payload = (data ?? {}) as {
        ok?: boolean; reason?: string; status?: string; athleteName?: string;
      };
      if (!payload.ok) {
        // One message for unknown, used and expired — the database deliberately
        // does not distinguish them, and neither should the screen.
        toast.error(
          payload.reason === "self_link"
            ? "You can't link your own account."
            : "That code isn't valid any more. Ask for a fresh one.",
        );
        return;
      }
      setRedeemInput("");
      toast.success(
        payload.status === "active"
          ? `Linked to ${payload.athleteName ?? "your athlete"}.`
          : `Code accepted. ${payload.athleteName ?? "Your athlete"} needs to approve it before you can see anything.`,
      );
      load();
    } finally {
      setRedeeming(false);
    }
  };

  const setLinkStatus = async (link: GuardianLink, status: "active" | "revoked") => {
    if (busyLink) return;
    setBusyLink(link.id);
    try {
      const { data, error } = await supabase.rpc("set_guardian_link_status", {
        p_link: link.id,
        p_status: status,
      });
      if (error) { toast.error(error.message); return; }
      const payload = (data ?? {}) as { ok?: boolean; reason?: string };
      if (!payload.ok) { toast.error("That link could not be updated."); return; }
      toast.success(status === "active" ? "Approved — they can see the sections below." : "Access switched off.");
      load();
    } finally {
      setBusyLink(null);
    }
  };

  const togglePermission = async (key: PermissionKey, value: boolean) => {
    if (!user || !currentPermissions || savingPermissions) return;
    if (locked.has(key) && !value) return; // the database would refuse it anyway
    const requested = { ...currentPermissions, [key]: value };
    setSavingPermissions(true);
    try {
      // Read the clamped map back rather than assuming the request survived: the
      // floors are enforced in Postgres, and a screen that shows what it asked
      // for instead of what was stored is how a guardian ends up surprised.
      const { data, error } = await supabase.rpc("set_guardian_permissions", {
        p_athlete: user.id,
        p_permissions: requested,
      });
      if (error) { toast.error(error.message); return; }
      const payload = (data ?? {}) as { ok?: boolean; permissions?: unknown };
      const safe = guardianSanitizePermissions(payload.permissions ?? requested, band);
      if (safe[key] !== value) {
        toast.info(
          key === "alerts"
            ? "Alerts stay on while you're under 18 — that one is not optional."
            : "That setting is fixed for your age group.",
        );
      }
      load();
    } finally {
      setSavingPermissions(false);
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(formatGuardianCode(code));
      toast.success("Code copied.");
    } catch {
      /* clipboard access can be refused; the code is on screen either way */
    }
  };

  return (
    <div className="min-h-screen pb-32 px-5 pt-[var(--vaylo-screen-top)] max-w-3xl mx-auto space-y-5">
      <Reveal>
        <Card className="p-5 bg-gradient-to-br from-primary/10 via-card to-card border-primary/25">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-[12px] uppercase tracking-[0.2em] text-muted-foreground">Family</p>
              <h1 className="text-2xl font-display font-bold text-gradient-electric">Guardian access</h1>
            </div>
            <ShieldCheck className="text-primary" size={28} />
          </div>
          <p className="text-xs text-muted-foreground">
            A parent or guardian can follow how your training is going without reading your training log.
            You choose what they see, and you can switch it off at any time.
          </p>
        </Card>
      </Reveal>

      {loading ? (
        <div className="p-10 text-center text-muted-foreground"><Loader2 className="animate-spin mx-auto" /></div>
      ) : (
        <>
          {/* ---------------------------------------------------------------- */}
          {/* Your guardians — the athlete's side, and the permission control   */}
          {/* ---------------------------------------------------------------- */}
          <Reveal delay={0.05}>
            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <KeyRound size={16} className="text-primary" aria-hidden />
                <h2 className="font-semibold">Your guardians</h2>
              </div>
              <p className="text-xs text-muted-foreground">
                Create a code and read it out to the adult who should have access. The code is single-use
                and expires in seven days. Under 13, a linked guardian is switched on straight away;
                at 13 and over, nothing is visible until you approve them.
              </p>

              {freshCode && (
                <div className="p-3 rounded-lg border border-success/40 bg-success/5">
                  <p className="text-[12px] uppercase tracking-wider text-muted-foreground mb-1">Your code</p>
                  <div className="flex items-center gap-2">
                    <p className="text-xl font-display font-bold tracking-[0.2em]">{formatGuardianCode(freshCode)}</p>
                    <Button size="sm" variant="ghost" onClick={() => copyCode(freshCode)} aria-label="Copy code">
                      <Copy size={14} />
                    </Button>
                  </div>
                  <p className="text-[12px] text-muted-foreground mt-1">
                    Single use. Anyone you give it to can see the sections you allow, so only share it with
                    someone you want to have it.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={createInvite} disabled={creatingInvite}>
                  {creatingInvite ? <Loader2 size={14} className="mr-1 animate-spin" /> : <RefreshCw size={14} className="mr-1" />}
                  {freshCode ? "Create another code" : "Create an invite code"}
                </Button>
              </div>

              {invites.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  {invites.length} unused code{invites.length === 1 ? "" : "s"} — the most recent expires in{" "}
                  {daysUntil(invites[0].expires_at) ?? 0} day{daysUntil(invites[0].expires_at) === 1 ? "" : "s"}.
                </div>
              )}

              {asAthlete.length === 0 ? (
                <p className="text-xs text-muted-foreground">No guardian is linked to your account.</p>
              ) : (
                <div className="divide-y divide-border">
                  {asAthlete.map(link => {
                    const meta = GUARDIAN_LINK_STATUS_META[link.status];
                    return (
                      <div key={link.id} className="py-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {RELATIONSHIP_LABELS[link.relationship] ?? "Guardian"}
                            </p>
                            <p className="text-[12px] text-muted-foreground">
                              Linked {link.created_at ? link.created_at.slice(0, 10) : "recently"}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={`text-[12px] shrink-0 ${
                              meta.tone === "positive" ? "text-success border-success/40"
                                : meta.tone === "watch" ? "text-muted-foreground border-border"
                                  : "text-primary border-primary/40"
                            }`}
                          >
                            {meta.label}
                          </Badge>
                        </div>
                        <p className="text-[12px] text-muted-foreground">{meta.description}</p>
                        <div className="flex flex-wrap gap-2">
                          {link.status === "pending" && (
                            <Button size="sm" variant="outline" disabled={busyLink === link.id}
                              onClick={() => setLinkStatus(link, "active")}>
                              <Check size={14} className="mr-1" /> Approve access
                            </Button>
                          )}
                          {link.status !== "revoked" && (
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                              disabled={busyLink === link.id}
                              onClick={() => setLinkStatus(link, "revoked")}>
                              <Link2Off size={14} className="mr-1" /> Switch off
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </Reveal>

          {/* Permission control — visible once there is an approved guardian. */}
          {currentPermissions && (
            <Reveal delay={0.1}>
              <Card className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={16} className="text-primary" aria-hidden />
                  <h2 className="font-semibold">What your guardian can see</h2>
                </div>
                <p className="text-xs text-muted-foreground">
                  These settings apply to every guardian you have approved. You are {AGE_BAND_LABELS[band].toLowerCase()},
                  which decides the settings you cannot switch off.
                </p>
                {(["progress", "training", "wellbeing"] as const).map(group => (
                  <div key={group} className="space-y-1">
                    <p className="text-[12px] uppercase tracking-wider text-muted-foreground">{PERMISSION_GROUP_TITLES[group]}</p>
                    {PERMISSION_KEYS.filter(k => PERMISSION_META[k].group === group).map(key => {
                      const isLocked = locked.has(key);
                      return (
                        <div key={key} className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
                          <Switch
                            checked={currentPermissions[key]}
                            disabled={isLocked || savingPermissions}
                            onCheckedChange={v => togglePermission(key, v)}
                            aria-label={PERMISSION_META[key].label}
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium">
                              {PERMISSION_META[key].label}
                              {isLocked && <span className="text-[12px] text-muted-foreground"> · always on for your age</span>}
                            </p>
                            <p className="text-[12px] text-muted-foreground">{PERMISSION_META[key].description}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
                <p className="text-[12px] text-muted-foreground">
                  {grantedPermissions(currentPermissions).length} of {PERMISSION_KEYS.length} sections shared.
                  Recovery is shared as a single band — a guardian never sees a score, a sleep number or a note.
                </p>
              </Card>
            </Reveal>
          )}

          {/* ---------------------------------------------------------------- */}
          {/* Redeem a code — the guardian's side                              */}
          {/* ---------------------------------------------------------------- */}
          <Reveal delay={0.15}>
            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-primary" aria-hidden />
                <h2 className="font-semibold">I'm a guardian</h2>
              </div>
              <p className="text-xs text-muted-foreground">
                Enter the 8-character code the athlete gave you. The athlete has to approve the link
                before anything becomes visible; an account held for someone under 13 is linked straight
                away, because you are the person responsible for it.
              </p>
              <div className="flex gap-2">
                <Input
                  value={redeemInput}
                  onChange={e => setRedeemInput(e.target.value.toUpperCase())}
                  placeholder="ABCD 2345"
                  maxLength={9}
                  className="tracking-[0.15em]"
                  aria-label="Guardian invite code"
                />
                <Button onClick={redeem} disabled={redeeming}>
                  {redeeming ? <Loader2 size={14} className="animate-spin" /> : "Link"}
                </Button>
              </div>
            </Card>
          </Reveal>

          {/* ---------------------------------------------------------------- */}
          {/* Athletes you follow — the sanitized parent dashboard             */}
          {/* ---------------------------------------------------------------- */}
          {(asGuardian.length > 0 || Object.keys(overviews).length > 0) && (
            <Reveal delay={0.2}>
              <div className="space-y-3">
                <h2 className="text-sm uppercase tracking-[0.2em] font-semibold text-muted-foreground">
                  Athletes you follow
                </h2>
                {overviewsLoading && (
                  <p className="text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin" /> Loading…
                  </p>
                )}
                {asGuardian.map(link => (
                  <GuardianAthleteCard
                    key={link.id}
                    overview={overviews[link.athlete_user_id]}
                    onRevoke={() => setLinkStatus(link, "revoked")}
                    busy={busyLink === link.id}
                  />
                ))}
                {asAthlete.some(l => l.status === "pending") && (
                  <p className="text-[12px] text-muted-foreground">
                    A guardian is waiting for your approval above. Until you approve, they can see nothing at all.
                  </p>
                )}
              </div>
            </Reveal>
          )}
        </>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* The parent's view of one athlete                                          */
/* -------------------------------------------------------------------------- */
/* Every section here is optional, because it is only present when the athlete
 * allowed it. A missing section renders nothing rather than an empty box: an
 * absence is the athlete's choice, and it should not read as a gap in the data. */

const GuardianSection = ({ icon, title, children }: {
  icon: React.ReactNode; title: string; children: React.ReactNode;
}) => (
  <div className="space-y-1">
    <p className="text-[12px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">{icon}{title}</p>
    {children}
  </div>
);

const GuardianAthleteCard = ({ overview, onRevoke, busy }: {
  overview?: GuardianOverviewResult;
  onRevoke: () => void;
  busy: boolean;
}) => {
  if (!overview) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading this athlete…
        </p>
      </Card>
    );
  }

  if (overview.ok !== true) {
    // Not an error: the database answers `no_access` without saying whether the
    // athlete exists, so the screen says the same thing.
    return (
      <Card className="p-4 space-y-2">
        <p className="text-sm font-medium">No access yet</p>
        <p className="text-xs text-muted-foreground">
          {overview.reason === "no_access"
            ? "This athlete hasn't approved your link, or has switched it off. Nothing is visible until they approve it."
            : "This athlete's summary could not be loaded."}
        </p>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onRevoke} disabled={busy}>
          <Link2Off size={14} className="mr-1" /> Remove this link
        </Button>
      </Card>
    );
  }

  const athlete: GuardianAthleteOverview = overview;
  const alerts = athlete.alerts ?? [];

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-lg truncate">{athlete.athlete.name}</h3>
          <p className="text-xs text-muted-foreground">
            {athlete.athlete.sports || "No sport recorded"} · {AGE_BAND_LABELS[athlete.athlete.ageBand]}
          </p>
        </div>
        {athlete.athlete.isMinor && (
          <Badge variant="outline" className="text-[12px] text-primary border-primary/40 shrink-0">Under 18</Badge>
        )}
      </div>

      {/* Safety and recovery alerts lead, because that is why they exist. */}
      {alerts.length > 0 && (
        <div className="space-y-1">
          {alerts.map((alert, i) => (
            <div key={`${alert.kind}-${i}`} className="rounded-md border border-energy/30 bg-energy/5 p-2 flex gap-2">
              <AlertTriangle size={13} className="text-energy shrink-0 mt-0.5" aria-hidden />
              <p className="text-xs">{alert.text}</p>
            </div>
          ))}
        </div>
      )}

      {athlete.consistency && (
        <GuardianSection icon={<Activity size={11} aria-hidden />} title="Training consistency">
          <div>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-muted-foreground">
                {athlete.consistency.completed} of {athlete.consistency.planned} planned sessions, last {athlete.consistency.windowDays} days
              </span>
              <span className="font-semibold">{athlete.consistency.percent == null ? "—" : `${athlete.consistency.percent}%`}</span>
            </div>
            <Progress value={athlete.consistency.percent ?? 0} className="h-2" />
            <p className="text-[12px] text-muted-foreground mt-1">
              Sessions a break cancelled are left out rather than counted as missed.
            </p>
          </div>
        </GuardianSection>
      )}

      {(athlete.recovery || athlete.workload) && (
        <GuardianSection icon={<HeartPulse size={11} aria-hidden />} title="Recovery & workload">
          <div className="grid grid-cols-2 gap-2 text-xs">
            {athlete.recovery && (
              <div className="rounded-md bg-muted/30 p-2">
                <p className="text-[12px] uppercase tracking-wider text-muted-foreground">Recovery</p>
                <p className="font-medium">{RECOVERY_BAND_LABELS[athlete.recovery.band]}</p>
              </div>
            )}
            {athlete.workload && (
              <div className="rounded-md bg-muted/30 p-2">
                <p className="text-[12px] uppercase tracking-wider text-muted-foreground">Workload</p>
                <p className="font-medium">{WORKLOAD_BAND_LABELS[athlete.workload.band]}</p>
              </div>
            )}
          </div>
        </GuardianSection>
      )}

      {athlete.goals && athlete.goals.length > 0 && (
        <GuardianSection icon={<Target size={11} aria-hidden />} title="Goals">
          <div className="space-y-1">
            {athlete.goals.map((goal, i) => (
              <div key={`${goal.title}-${i}`} className="text-xs flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-medium">{goal.title}</span>
                  {goal.category && <span className="text-muted-foreground"> · {goal.category}</span>}
                </span>
                <span className="text-muted-foreground shrink-0">
                  {goal.progressStatus ? goal.progressStatus.replace("_", " ") : goal.status ?? ""}
                  {goal.targetDate ? ` · ${goal.targetDate}` : ""}
                </span>
              </div>
            ))}
          </div>
        </GuardianSection>
      )}

      {athlete.roadmap && athlete.roadmap.length > 0 && (
        <GuardianSection icon={<Compass size={11} aria-hidden />} title="Development roadmap">
          <div className="space-y-2">
            {athlete.roadmap.map((r, i) => (
              <div key={`${r.title}-${i}`} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="font-medium truncate">
                    {r.title}
                    {r.phase && <span className="text-muted-foreground"> · {r.phase}</span>}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {r.milestonesAchieved}/{r.milestonesTotal} milestones
                  </span>
                </div>
                {r.milestonesTotal > 0 && (
                  <Progress value={Math.round((r.milestonesAchieved / r.milestonesTotal) * 100)} className="h-1.5" />
                )}
                {r.nextMilestone && (
                  <p className="text-[12px] text-muted-foreground">Next: {r.nextMilestone}</p>
                )}
              </div>
            ))}
          </div>
        </GuardianSection>
      )}

      {athlete.upcoming && athlete.upcoming.length > 0 && (
        <GuardianSection icon={<CalendarDays size={11} aria-hidden />} title="Upcoming training">
          <div className="space-y-1">
            {athlete.upcoming.slice(0, 8).map((s, i) => (
              <div key={`${s.date}-${i}`} className="text-xs flex justify-between gap-2">
                <span className="truncate">{s.title}</span>
                <span className="text-muted-foreground shrink-0">{s.date}</span>
              </div>
            ))}
          </div>
        </GuardianSection>
      )}

      {athlete.completedRecent && athlete.completedRecent.length > 0 && (
        <GuardianSection icon={<Check size={11} aria-hidden />} title="Completed training">
          <div className="space-y-1">
            {athlete.completedRecent.slice(0, 8).map((s, i) => (
              <div key={`${s.date}-${i}`} className="text-xs flex justify-between gap-2">
                <span className="truncate">{s.title}</span>
                <span className="text-muted-foreground shrink-0">{s.date}</span>
              </div>
            ))}
          </div>
        </GuardianSection>
      )}

      {athlete.competitions && athlete.competitions.length > 0 && (
        <GuardianSection icon={<Trophy size={11} aria-hidden />} title="Competitions">
          <div className="space-y-1">
            {athlete.competitions.map((c, i) => (
              <div key={`${c.title}-${i}`} className="text-xs flex justify-between gap-2">
                <span className="truncate">{c.title}{c.sport ? ` · ${c.sport}` : ""}</span>
                <span className="text-muted-foreground shrink-0">{c.date}</span>
              </div>
            ))}
          </div>
        </GuardianSection>
      )}

      {athlete.coach && (
        <GuardianSection icon={<Users size={11} aria-hidden />} title="Coach">
          <p className="text-xs text-muted-foreground">
            {athlete.coach.linked && athlete.coach.name
              ? `${athlete.coach.name} is linked to this account.`
              : "No coach is linked to this account yet."}
          </p>
        </GuardianSection>
      )}

      <p className="text-[12px] text-muted-foreground border-t border-border pt-2">{GUARDIAN_SUMMARY_NOTE}</p>
      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onRevoke} disabled={busy}>
        <Link2Off size={14} className="mr-1" /> Step back from this link
      </Button>
    </Card>
  );
};

export default Guardian;
