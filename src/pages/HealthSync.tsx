import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  HeartPulse, Loader2, RefreshCw, Smartphone, Check, Info,
  AlertTriangle, ShieldCheck, ExternalLink, Clock, X,
  Activity, Footprints, Flame, Timer, Moon, Watch, Unlink,
  Zap, Link2, Sparkles, ChevronRight,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useHealthConnect } from "@/hooks/useHealthConnect";
import { HEALTH_PERMISSION_LIST } from "@/lib/health/permissions";
import { WEARABLE_PROVIDERS } from "@/lib/health/providers";
import type { WearableProviderId } from "@/lib/health/providers";
import { isAndroid, isIOS, openExternal } from "@/lib/platform";
import { oauthStart, oauthDisconnect, parseWearableRedirect } from "@/lib/health/oauth";
import { fetchWearableConnections, type WearableConnectionMap } from "@/lib/health/connections";

// ──────────────────────────────────────────────────────────────────────────
// Wearables — unified hub for every watch Vaylo Sports supports.
// Native hubs (Health Connect on Android, HealthKit on iOS) are on-device:
// every requested watch already writes into one of them (Samsung, Google,
// Fitbit, Garmin, Polar, COROS, WHOOP, Oura all bridge into Health Connect
// on Android; Apple Watch into HealthKit on iOS). Cloud OAuth (Garmin,
// Fitbit, Polar, COROS, WHOOP, Oura, Strava, Suunto, Withings …) gives a
// direct path and is additive — same normalized rows, same dedup.
// ──────────────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, { label: string; dot: string; text: string }> = {
  checking: { label: "Checking…", dot: "bg-muted-foreground", text: "text-muted-foreground" },
  unavailable: { label: "Not available", dot: "bg-muted-foreground", text: "text-muted-foreground" },
  not_connected: { label: "Not connected", dot: "bg-amber-400", text: "text-amber-300" },
  permission_required: { label: "Permission required", dot: "bg-amber-400", text: "text-amber-300" },
  connected: { label: "Connected", dot: "bg-emerald-400", text: "text-emerald-300" },
  token_expired: { label: "Reconnect needed", dot: "bg-amber-400", text: "text-amber-300" },
};

const PROVIDER_ICON: Record<WearableProviderId, typeof Watch> = {
  health_connect: Smartphone,
  healthkit: Smartphone,
  garmin: Watch,
  fitbit: Watch,
  polar: HeartPulse,
  coros: Watch,
  whoop: HeartPulse,
  oura: Moon,
  samsung_health: Watch,
  google_fit: Watch,
  suunto: Watch,
  withings: HeartPulse,
  strava: Activity,
  huawei: Watch,
};

const CLOUD_SECTION: WearableProviderId[] = [
  "garmin", "fitbit", "polar", "coros", "samsung_health", "google_fit", "huawei",
];
const RECOVERY_SECTION: WearableProviderId[] = ["whoop", "oura", "withings"];
const SOCIAL_SECTION: WearableProviderId[] = ["strava", "suunto"];

const ACTIVITY_LABELS: Record<string, string> = { "56": "Running", "1": "Biking", "8": "Walking", "9": "Hiking" };
const fmtDuration = (s: number | null) => {
  if (s == null) return "—";
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};
const fmtDist = (m: number | string | null) => {
  if (m == null) return "—";
  const km = Number(m) / 1000;
  return `${km.toFixed(km >= 10 ? 1 : 2)} km`;
};
const fmtHr = (avg: number | string | null, max: number | string | null) => {
  if (avg == null) return "—";
  const a = Math.round(Number(avg));
  return max != null ? `${a} (max ${Math.round(Number(max))}) bpm` : `${a} bpm`;
};

type HealthWorkoutRow = {
  id: string;
  source: string;
  title: string | null;
  activity_type: string | null;
  start_time: string;
  end_time: string;
  duration_seconds: number | null;
  distance_meters: number | null;
  active_calories: number | null;
  heart_rate_avg: number | null;
  heart_rate_max: number | null;
  heart_rate_min: number | null;
  steps: number | null;
};

type HealthSampleRow = {
  id: string;
  source: string;
  metric: string;
  start_time: string;
  end_time: string;
  value: number | string;
  unit: string | null;
  stage: string | null;
};

type BusyProvider = WearableProviderId | "__all__" | null;

const HealthSync = () => {
  const { user } = useAuth();
  const hc = useHealthConnect();
  const hcStyle = STATUS_STYLES[hc.status] ?? STATUS_STYLES.checking;
  const hcConnected = hc.status === "connected";

  const [manual, setManual] = useState({ type: "run", duration: "", distance: "", calories: "" });
  const [recentWorkouts, setRecentWorkouts] = useState<HealthWorkoutRow[]>([]);
  const [recentSamples, setRecentSamples] = useState<HealthSampleRow[]>([]);
  const [loadingLive, setLoadingLive] = useState(false);
  const [cloudMap, setCloudMap] = useState<WearableConnectionMap>({} as WearableConnectionMap);
  const [cloudLoading, setCloudLoading] = useState(true);
  const [busyProvider, setBusyProvider] = useState<BusyProvider>(null);
  const [syncingAll, setSyncingAll] = useState(false);

  const onAndroid = isAndroid();
  const onIOS = isIOS();

  const refreshCloud = useCallback(async () => {
    if (!user) return;
    setCloudLoading(true);
    try {
      const m = await fetchWearableConnections(user.id);
      setCloudMap(m);
    } finally {
      setCloudLoading(false);
    }
  }, [user]);

  useEffect(() => { if (user) void refreshCloud(); }, [user, refreshCloud]);

  // Handle OAuth redirect callback (vendor → edge → app deep link with ?wearable=garmin&connected=1)
  useEffect(() => {
    const parsed = parseWearableRedirect(window.location.href);
    if (parsed.provider && parsed.connected) {
      toast.success(`${WEARABLE_PROVIDERS[parsed.provider]?.label ?? parsed.provider} connected`);
      if (user) void refreshCloud();
      // Clean the query so refresh doesn't re-toast
      const u = new URL(window.location.href);
      u.searchParams.delete("wearable");
      u.searchParams.delete("provider");
      u.searchParams.delete("connected");
      window.history.replaceState({}, "", u.toString());
    }
  }, [user, refreshCloud]);

  const submitManual = async () => {
    if (!user) return;
    const dur = Number(manual.duration);
    if (!dur) return toast.error("Duration required");
    const { error } = await supabase.from("workouts").insert({
      user_id: user.id,
      title: `${manual.type} (manual import)`,
      type: manual.type,
      started_at: new Date(Date.now() - dur * 60_000).toISOString(),
      completed_at: new Date().toISOString(),
      duration_minutes: dur,
      distance_km: manual.distance ? Number(manual.distance) : null,
      calories_burned: manual.calories ? Number(manual.calories) : null,
      completed: true,
      notes: "Manual import",
    });
    if (error) return toast.error(error.message);
    toast.success("Workout imported.");
    setManual({ type: "run", duration: "", distance: "", calories: "" });
  };

  const loadLiveData = useCallback(async () => {
    if (!user) return;
    setLoadingLive(true);
    const [{ data: w }, { data: s }] = await Promise.all([
      supabase.from("health_workouts").select("id, source, title, activity_type, start_time, end_time, duration_seconds, distance_meters, active_calories, heart_rate_avg, heart_rate_max, heart_rate_min, steps").eq("user_id", user.id).eq("deleted", false).order("start_time", { ascending: false }).limit(12),
      supabase.from("health_samples").select("id, source, metric, start_time, end_time, value, unit, stage").eq("user_id", user.id).eq("deleted", false).order("start_time", { ascending: false }).limit(12),
    ]);
    setRecentWorkouts(w ?? []);
    setRecentSamples(s ?? []);
    setLoadingLive(false);
  }, [user]);

  useEffect(() => { if (user && (hcConnected || hc.syncState.lastSyncAt || Object.keys(cloudMap).length)) void loadLiveData(); }, [user?.id, hcConnected, hc.syncState.lastSyncAt, cloudMap, loadLiveData]);
  useEffect(() => { if (!hc.syncing && hcConnected) void loadLiveData(); }, [hc.syncing, hcConnected, loadLiveData]);

  const handleCloudConnect = async (provider: WearableProviderId) => {
    setBusyProvider(provider);
    try {
      const { url } = await oauthStart(provider);
      await openExternal(url);
      toast.message(`Opening ${WEARABLE_PROVIDERS[provider].label}…`, {
        description: "Complete the grant in your browser, then return here.",
      });
    } catch (e) {
      const msg = String(e?.message ?? "");
      if (msg.includes("not_configured")) {
        toast.info(`${WEARABLE_PROVIDERS[provider].label} — use Health Connect for now`, {
          description: "Direct OAuth for this watch is coming soon. On Android, connect it through Health Connect above — most watches sync that way already.",
        });
      } else {
        toast.error(msg || "Couldn't start connection");
      }
    } finally {
      setBusyProvider(null);
    }
  };

  const handleCloudDisconnect = async (provider: WearableProviderId) => {
    setBusyProvider(provider);
    try {
      await oauthDisconnect(provider);
      toast.success(`${WEARABLE_PROVIDERS[provider].label} disconnected`);
      await refreshCloud();
    } catch (e) {
      toast.error(String(e?.message ?? "Couldn't disconnect"));
    } finally {
      setBusyProvider(null);
    }
  };

  const handleCloudSync = async (provider?: WearableProviderId) => {
    setBusyProvider(provider ?? "__all__");
    if (!provider) setSyncingAll(true);
    try {
      const { error } = await supabase.functions.invoke("wearable-oauth", {
        body: { action: "sync", provider: provider ?? undefined },
      });
      if (error) throw new Error(error.message);
      toast.success(provider ? `${WEARABLE_PROVIDERS[provider].label} sync requested` : "Sync requested for all connected wearables");
      await refreshCloud();
      await loadLiveData();
    } catch (e) {
      toast.error(String(e?.message ?? "Sync failed"));
    } finally {
      setBusyProvider(null);
      setSyncingAll(false);
    }
  };

  const connectedCount = useMemo(() => {
    const cloudConnected = Object.values(cloudMap).filter((c) => c?.connected).length;
    return (hcConnected ? 1 : 0) + cloudConnected;
  }, [hcConnected, cloudMap]);

  const anyConnected = connectedCount > 0;

  const ProviderCard = ({ id }: { id: WearableProviderId }) => {
    const spec = WEARABLE_PROVIDERS[id];
    const Icon = PROVIDER_ICON[id] ?? Watch;
    const isHC = id === "health_connect";
    const isHK = id === "healthkit";
    const isCloud = spec.family === "cloud";
    const conn = isHC ? null : cloudMap[id];
    const connected = isHC ? hcConnected : !!conn?.connected;
    const lastSync = isHC ? hc.syncState.lastSyncAt : (conn?.lastSyncAt ?? null);
    const busy = busyProvider === id;
    const showConnect = !connected && !busy;
    const statusKey = connected ? "connected" : (isCloud && conn?.status) ? conn.status : "not_connected";
    const style = STATUS_STYLES[statusKey] ?? STATUS_STYLES.not_connected;

    // Platform hint
    const platformHint = (() => {
      if (isHC) return onAndroid ? null : "Android only — on iPhone, use Apple Health below.";
      if (isHK) return onIOS ? null : "iPhone only — on Android, use Health Connect above.";
      if (spec.healthConnectBridged && onAndroid) return "Also syncs automatically via Health Connect — no extra link required.";
      return null;
    })();

    return (
      <div className="rounded-[22px] border border-white/[0.07] bg-card/60 backdrop-blur-xl p-4 shadow-card overflow-hidden relative">
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[22px] bg-gradient-to-b from-white/[0.05] via-transparent to-transparent" />
        <div className="relative">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`h-10 w-10 rounded-xl bg-gradient-to-br ${spec.accent} flex items-center justify-center text-white shadow-glow shrink-0 border border-white/10`}>
                <Icon size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-bold leading-tight truncate">{spec.label}</p>
                <p className="text-[11px] text-muted-foreground truncate">{spec.subtitle}</p>
              </div>
            </div>
            <span className={`inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[10px] font-bold shrink-0 ${style.text}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} /> {style.label}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground line-clamp-2">{spec.blurb}</p>
          {spec.healthConnectBridged && isCloud && onAndroid && (
            <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-300">
              <Check size={10} /> Health Connect bridge
            </p>
          )}
          {platformHint && (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground/80 flex items-start gap-1.5">
              <Info size={11} className="mt-0.5 shrink-0" /> {platformHint}
            </p>
          )}
          {lastSync && (
            <p className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock size={10} /> Last sync {new Date(lastSync).toLocaleString()}
            </p>
          )}

          {/* Actions */}
          <div className="mt-3 flex gap-2">
            {isHC ? (
              <>
                {(hc.status === "not_connected" || hc.status === "permission_required" || hc.consentOutdated) && hc.status !== "unavailable" ? (
                  <Button onClick={() => void hc.connect()} disabled={hc.connecting || hc.checking} className="flex-1 h-9 rounded-xl bg-gradient-primary text-primary-foreground font-semibold shadow-glow text-xs">
                    {hc.connecting ? <><Loader2 size={14} className="animate-spin mr-1.5" /> Connecting…</> : <><Link2 size={14} className="mr-1.5" /> Connect</>}
                  </Button>
                ) : hcConnected ? (
                  <>
                    <Button onClick={() => void hc.sync()} disabled={hc.syncing} className="flex-1 h-9 rounded-xl bg-gradient-primary text-primary-foreground font-semibold shadow-glow text-xs">
                      {hc.syncing ? <><Loader2 size={14} className="animate-spin mr-1.5" /> Syncing…</> : <><RefreshCw size={14} className="mr-1.5" /> Sync now</>}
                    </Button>
                    <Button onClick={() => void hc.managePermissions()} variant="outline" className="h-9 rounded-xl border-white/[0.08] bg-white/[0.04] backdrop-blur text-xs">
                      <ExternalLink size={14} className="mr-1" /> Manage
                    </Button>
                  </>
                ) : null}
              </>
            ) : isHK ? (
              <div className="flex-1 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[11px] text-muted-foreground">
                HealthKit sync is available inside the iOS build. Install Vaylo Sports on iPhone and grant Health access — watches appear automatically.
              </div>
            ) : showConnect ? (
              <Button onClick={() => void handleCloudConnect(id)} disabled={!!busyProvider} className="flex-1 h-9 rounded-xl bg-gradient-primary text-primary-foreground font-semibold shadow-glow text-xs border border-white/10">
                <Link2 size={14} className="mr-1.5" /> Connect {spec.label}
              </Button>
            ) : connected ? (
              <>
                <Button onClick={() => void handleCloudSync(id)} disabled={!!busyProvider} className="flex-1 h-9 rounded-xl bg-gradient-primary text-primary-foreground font-semibold shadow-glow text-xs">
                  {busy ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <RefreshCw size={14} className="mr-1.5" />} Sync
                </Button>
                <Button onClick={() => void handleCloudDisconnect(id)} disabled={!!busyProvider} variant="outline" className="h-9 rounded-xl border-white/[0.08] bg-white/[0.04] text-xs">
                  <Unlink size={14} className="mr-1" /> Disconnect
                </Button>
              </>
            ) : (
              <Button onClick={() => void handleCloudConnect(id)} disabled={!!busyProvider} variant="outline" className="flex-1 h-9 rounded-xl border-white/[0.08] bg-white/[0.04] text-xs">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <><Link2 size={14} className="mr-1.5" /> Connect</>}
              </Button>
            )}
          </div>
          {isCloud && spec.helpUrl && !connected && (
            <button type="button" onClick={() => void openExternal(spec.helpUrl!)} className="mt-2 text-[11px] text-primary hover:underline flex items-center gap-1">
              How to link {spec.label} <ExternalLink size={11} />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen app-mesh pb-32 max-w-3xl mx-auto px-5 pt-12">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.04] backdrop-blur px-3 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_hsla(142_76%_36%_/_0.8)]" />
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Wearables</span>
        </div>
        <h1 className="mt-3 text-[32px] font-display font-bold tracking-tight leading-none">
          <span className="bg-gradient-to-br from-white via-white to-white/70 bg-clip-text text-transparent">Sync your</span>{" "}
          <span className="bg-gradient-to-r from-violet-400 via-indigo-400 to-sky-400 bg-clip-text text-transparent">watches</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
          Connect once, sync when you tap. COROS, Garmin, Polar, Fitbit, Samsung, Apple, Google, WHOOP, Oura and more — workouts, heart rate, distance, steps, sleep and calories land as one normalized log.
        </p>
        {anyConnected && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-200">
            <Check size={12} /> {connectedCount} {connectedCount === 1 ? "wearable" : "wearables"} connected
            <button type="button" onClick={() => void handleCloudSync()} disabled={syncingAll || hc.syncing} className="ml-1 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[11px] font-bold hover:bg-white/15">
              {syncingAll ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Sync all
            </button>
          </div>
        )}
      </motion.div>

      {hc.error && (
        <div className="mt-4 flex items-start justify-between gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-3 py-2">
          <p className="text-xs text-destructive leading-relaxed">{hc.error}</p>
          <button type="button" onClick={hc.clearError} aria-label="Dismiss"><X size={13} className="text-destructive mt-0.5" /></button>
        </div>
      )}

      {/* ── On your phone ── */}
      <div className="mt-6">
        <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-3">
          <Smartphone size={12} /> On your phone
        </h2>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <ProviderCard id="health_connect" />
          <ProviderCard id="healthkit" />
        </div>
        {/* Platform gate for Health Connect */}
        {!hc.checking && hc.status === "unavailable" && !onAndroid && (
          <div className="mt-3 flex items-start gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.04] backdrop-blur px-3 py-3">
            <Info size={14} className="text-muted-foreground mt-0.5 shrink-0" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Health Connect is Android-only. Open Vaylo Sports on your Android device to connect watches that way — on iPhone, Apple Watch syncs via HealthKit automatically. Cloud links below work everywhere.
            </p>
          </div>
        )}
        {hc.status === "permission_required" && (
          <p className="mt-2 text-xs text-amber-300/90 px-1">Some permissions were turned off. Reconnect to restore them — we only ask once.</p>
        )}
      </div>

      {/* ── Watches ── */}
      <div className="mt-6">
        <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-3">
          <Watch size={12} /> Watches & bands
          <span className="ml-auto text-[10px] font-semibold normal-case tracking-normal text-muted-foreground/70">
            {cloudLoading ? "Checking…" : `${Object.values(cloudMap).filter((c) => c?.connected).length} connected`}
          </span>
        </h2>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {CLOUD_SECTION.map((id) => <ProviderCard key={id} id={id} />)}
        </div>
      </div>

      {/* ── Recovery ── */}
      <div className="mt-6">
        <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-3">
          <Moon size={12} /> Recovery & sleep
        </h2>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {RECOVERY_SECTION.map((id) => <ProviderCard key={id} id={id} />)}
        </div>
      </div>

      {/* ── Social / extras ── */}
      <div className="mt-6">
        <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-3">
          <Sparkles size={12} /> Network & extras
        </h2>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          {SOCIAL_SECTION.map((id) => <ProviderCard key={id} id={id} />)}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          Strava imports from any watch that posts to Strava; Suunto, Withings and Huawei round out the long tail. Every import writes the same normalized rows — one provider per workout, deduplicated by your account.
        </p>
      </div>

      {/* ── Bridge tip ── */}
      <div className="mt-6 rounded-[22px] border border-white/[0.07] bg-card/60 backdrop-blur-xl p-4 shadow-card overflow-hidden relative">
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[22px] bg-gradient-to-b from-white/[0.05] via-transparent to-transparent" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-8 w-8 rounded-xl bg-gradient-primary flex items-center justify-center text-primary-foreground shadow-glow"><Zap size={14} /></div>
            <h3 className="text-sm font-bold">Most watches need no extra link on Android</h3>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Samsung Galaxy Watch, Pixel Watch / Wear OS, Fitbit, Garmin, Polar, COROS, WHOOP, Oura and Huawei Health already write into Health Connect on your phone. Install Health Connect, connect your watch to it once, then connect Health Connect here — workouts arrive without any cloud OAuth. Use the direct links above only if you prefer a cloud copy or your watch does not bridge locally.
          </p>
        </div>
      </div>

      {/* ── Data permissions ── */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}
        className="mt-4 rounded-[22px] border border-white/[0.07] bg-card/60 backdrop-blur-xl p-4 shadow-card overflow-hidden relative">
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[22px] bg-gradient-to-b from-white/[0.05] via-transparent to-transparent" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={15} className="text-emerald-400" />
            <h3 className="text-sm font-bold">Data we request</h3>
          </div>
          <div className="space-y-2">
            {HEALTH_PERMISSION_LIST.map(([key, spec]) => (
              <div key={key} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2">
                <p className="text-xs font-semibold">{spec.label}</p>
                <p className="text-[11px] text-muted-foreground text-right max-w-[60%]">{spec.why}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Read access only, for these six types. We never sell or share your health data, never use it for advertising, and never log its contents. Revoke any permission at any time — syncing pauses, already-imported rows stay yours and are deleted with your account.
          </p>
        </div>
      </motion.div>

      {/* ── Synced from your wearables ── */}
      {(hcConnected || recentWorkouts.length > 0 || recentSamples.length > 0 || Object.values(cloudMap).some((c) => c?.connected)) && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="mt-4 rounded-[22px] border border-white/[0.07] bg-card/60 backdrop-blur-xl p-4 shadow-card overflow-hidden relative">
          <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[22px] bg-gradient-to-b from-white/[0.05] via-transparent to-transparent" />
          <div className="relative">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2"><Activity size={15} className="text-primary" />
                <h3 className="text-sm font-bold">Synced to Vaylo Sports</h3>
              </div>
              <button type="button" onClick={() => void loadLiveData()} disabled={loadingLive} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.03] px-2.5 py-1">
                {loadingLive ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
              </button>
            </div>

            {recentWorkouts.length === 0 && recentSamples.length === 0 ? (
              <p className="text-xs leading-relaxed text-muted-foreground">
                No workouts yet. Connect a watch above, seed a session on your device, then tap <strong>Sync</strong> — it appears here the moment the server confirms it.
              </p>
            ) : (
              <div className="space-y-3">
                {recentWorkouts.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-2">Workouts</p>
                    <div className="space-y-2">
                      {recentWorkouts.map((w) => {
                        const providerId = (w.source && w.source !== "health_connect" ? w.source : "health_connect") as WearableProviderId;
                        const providerLabel = (WEARABLE_PROVIDERS[providerId]?.label ?? w.source ?? "—");
                        return (
                          <div key={w.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] backdrop-blur px-3 py-2.5">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-xs font-bold leading-tight">{w.title ?? ACTIVITY_LABELS[w.activity_type] ?? `Activity ${w.activity_type}`}</p>
                              <span className="shrink-0 rounded-full bg-white/[0.06] border border-white/[0.06] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{providerLabel}</span>
                            </div>
                            <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{new Date(w.start_time).toLocaleString()}</p>
                            <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px]">
                              <span className="flex items-center gap-1 text-muted-foreground"><Timer size={12} /> {fmtDuration(w.duration_seconds)}</span>
                              <span className="flex items-center gap-1 text-muted-foreground"><Activity size={12} /> {fmtDist(w.distance_meters)}</span>
                              <span className="flex items-center gap-1 text-muted-foreground"><Flame size={12} /> {w.active_calories != null ? `${Math.round(Number(w.active_calories))} kcal` : "—"}</span>
                              <span className="flex items-center gap-1 text-muted-foreground"><HeartPulse size={12} /> {fmtHr(w.heart_rate_avg, w.heart_rate_max)}</span>
                              <span className="flex items-center gap-1 text-muted-foreground"><Footprints size={12} /> {w.steps != null ? `${w.steps} steps` : "—"}</span>
                              <span className="text-[10px] font-mono text-muted-foreground truncate">{ACTIVITY_LABELS[w.activity_type] ? "" : `#${w.activity_type}`}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {recentSamples.length > 0 && (
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground mb-2">Samples</p>
                    <div className="space-y-1.5">
                      {recentSamples.map((s) => (
                        <div key={s.id} className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.03] backdrop-blur px-3 py-2 text-xs">
                          <span className="flex items-center gap-1.5 font-semibold capitalize">{s.metric === "sleep" ? <Moon size={12} /> : s.metric === "steps" ? <Footprints size={12} /> : <Activity size={12} />}{s.metric}<span className="rounded-full bg-white/[0.06] border border-white/[0.06] px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground ml-1">{s.source ?? "—"}</span></span>
                          <span className="text-muted-foreground font-mono text-[11px]">{s.metric === "sleep" && s.value == null ? `${Math.round((new Date(s.end_time).getTime() - new Date(s.start_time).getTime()) / 3600000 * 10) / 10}h` : s.value != null ? `${s.value} ${s.unit}` : "—"} · {new Date(s.start_time).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* ── Manual import ── */}
      <div className="mt-4 rounded-[22px] border border-white/[0.07] bg-card/60 backdrop-blur-xl p-4 shadow-card overflow-hidden relative">
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[22px] bg-gradient-to-b from-white/[0.05] via-transparent to-transparent" />
        <div className="relative space-y-3">
          <h3 className="text-sm font-bold flex items-center gap-2"><ChevronRight size={14} className="text-muted-foreground" /> Manual workout import</h3>
          <p className="text-xs text-muted-foreground">No watch? Log a session by hand — it counts the same as a synced one.</p>
          <div className="grid grid-cols-2 gap-2">
            <select value={manual.type} onChange={(e) => setManual({ ...manual, type: e.target.value })}
              className="rounded-xl border border-white/[0.08] bg-white/[0.04] backdrop-blur px-3 py-2.5 text-sm">
              {["run", "cycle", "swim", "gym", "hiit", "sport", "yoga", "row"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <Input placeholder="Duration (min)" type="number" value={manual.duration} onChange={(e) => setManual({ ...manual, duration: e.target.value })} />
            <Input placeholder="Distance (km)" type="number" step="0.01" value={manual.distance} onChange={(e) => setManual({ ...manual, distance: e.target.value })} />
            <Input placeholder="Calories" type="number" value={manual.calories} onChange={(e) => setManual({ ...manual, calories: e.target.value })} />
          </div>
          <Button onClick={submitManual} className="w-full rounded-xl bg-gradient-primary shadow-glow">Import</Button>
        </div>
      </div>

      {!hc.checking && hc.status === "unavailable" && !anyConnected && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-3">
          <AlertTriangle size={14} className="text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs leading-relaxed text-amber-200/90">
            Wearable sync is optional — Vaylo Sports's training, coaching and analytics work without it. Connect when you're ready.
          </p>
        </div>
      )}
    </div>
  );
};

export default HealthSync;
