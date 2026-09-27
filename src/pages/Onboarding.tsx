import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronRight, ChevronLeft, Sparkles, Activity, Target, Calendar, Rocket, Cake, MapPin } from "lucide-react";
import { toast } from "sonner";
import { ageBand, earliestDob, validateDob } from "@/lib/age";
import { localDateKey } from "@/lib/dates";
import CountrySelect from "@/components/geo/CountrySelect";
import { continentFor, countryName, currencyFor, normaliseCountryCode } from "@/lib/geo";

const SPORTS = ["Running", "Cycling", "Football", "Basketball", "Tennis", "Swimming", "Weightlifting", "Triathlon", "Climbing", "MMA / Boxing", "Other"];
const LEVELS = ["Beginner", "Intermediate", "Advanced", "Elite"];
const GOALS = [
  "Build endurance", "Get stronger", "Lose fat", "Gain muscle", "Compete & win", "Improve health",
  "Boost speed", "Increase power", "Improve mobility", "Sharpen agility", "Raise VO2 Max",
  "Break a personal best", "Return from injury", "Master technique", "Improve mental toughness",
  "Prepare for an event", "Build explosiveness", "Improve recovery", "Reduce body fat %",
  "Increase lean mass", "Sport-specific skill work", "Improve balance & coordination",
  "Cross-train new sport", "Improve consistency", "Longevity & healthspan",
];
const DAYS = [2, 3, 4, 5, 6, 7];

const DRAFT_KEY = "vaylo:onboarding-draft";

type Draft = { sport: string; level: string; goal: string; days: number; name: string; dob: string; country: string };
const EMPTY: Draft = { sport: "", level: "", goal: "", days: 4, name: "", dob: "", country: "" };

function loadDraft(): Draft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? { ...EMPTY, ...JSON.parse(raw) } : EMPTY;
  } catch { return EMPTY; }
}

export default function Onboarding() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<Draft>(loadDraft);

  useEffect(() => { if (!user) navigate("/auth"); }, [user, navigate]);

  // Remember anything already saved on the profile, and anything typed here.
  useEffect(() => {
    if (!profile) return;
    setData((prev) => ({
      ...prev,
      sport: prev.sport || profile.sport || "",
      level: prev.level || (profile.experience_level ? profile.experience_level.charAt(0).toUpperCase() + profile.experience_level.slice(1) : ""),
      goal: prev.goal || profile.goals?.[0] || "",
      name: prev.name || profile.full_name || "",
      dob: prev.dob || profile.date_of_birth || "",
    }));
  }, [profile]);

  useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch { /* ignore */ }
  }, [data]);

  // Country lives in `user_region`, not `profiles`. Read the athlete's own row so
  // returning to this screen shows what they already picked.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data: row } = await supabase
        .from("user_region")
        .select("country")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled && row?.country) {
        setData((prev) => ({ ...prev, country: prev.country || row.country }));
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const steps = [
    { key: "sport", title: "What's your sport?", subtitle: "We'll tailor everything to it." },
    { key: "level", title: "How experienced are you?", subtitle: "We start where you are." },
    { key: "goal", title: "What's your main goal?", subtitle: "We'll build your plan around it." },
    { key: "days", title: "Training days per week?", subtitle: "Be realistic — consistency beats heroics." },
    { key: "age", title: "When were you born?", subtitle: "We use your age to keep training loads sensible. Sponsored content is only shown to over-18s." },
    { key: "country", title: "Where are you based?", subtitle: "This puts you on your country and continental leaderboards. Your country is public on the board — nothing else about you is." },
    { key: "preview", title: "Your dashboard is ready", subtitle: "Here's a quick preview of what's waiting." },
  ];

  const total = steps.length;
  const cur = steps[step];

  const canContinue = () => {
    if (cur.key === "sport") return !!data.sport;
    if (cur.key === "level") return !!data.level;
    if (cur.key === "goal") return !!data.goal;
    if (cur.key === "days") return data.days > 0;
    // Date of birth is optional — no age means no sponsored content, which is
    // the safe default. An entered date must be plausible to continue.
    if (cur.key === "age") return !validateDob(data.dob);
    if (cur.key === "country") return !!normaliseCountryCode(data.country);
    return true;
  };

  const save = async (complete: boolean) => {
    if (!user) return;
    setBusy(true);
    try {
      // Merge rather than overwrite: extended_profile is shared JSON and other
      // flows may add keys to it later.
      const { data: current } = await supabase
        .from("profiles")
        .select("extended_profile")
        .eq("user_id", user.id)
        .maybeSingle();
      const existingExtended = (current?.extended_profile ?? {}) as Record<string, unknown>;

      const { error } = await supabase.from("profiles").update({
        sport: data.sport || undefined,
        experience_level: data.level ? data.level.toLowerCase() : undefined,
        goals: data.goal ? [data.goal] : undefined,
        full_name: data.name || undefined,
        // Stored as a date of birth rather than an age so it never goes stale,
        // and so the 18+ gate can be derived server-side (see src/lib/age.ts).
        date_of_birth: data.dob || undefined,
        extended_profile: { ...existingExtended, training_days_per_week: data.days },
        onboarding_complete: complete,
      }).eq("user_id", user.id);

      // Supabase returns errors rather than throwing, so this check is what
      // stops us telling the athlete "you're in" when nothing was saved.
      if (error) throw error;

      // Country drives the country/continental leaderboards, so it is stored in
      // `user_region` (which is what the boards read) rather than in the profile
      // JSON. Only the country code and its currency seed are written.
      const countryCode = normaliseCountryCode(data.country);
      if (countryCode) {
        const { error: regionError } = await supabase.from("user_region").upsert(
          {
            user_id: user.id,
            country: countryCode,
            currency: currencyFor(countryCode) ?? "USD",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
        if (regionError) throw regionError;
      }

      await refreshProfile();
      toast.success(complete ? "You're in. Let's go." : "Saved — you can finish this later in Profile.");
      navigate("/");
    } catch (e) {
      toast.error(e?.message ?? "Couldn't save your profile. Please try again.");
    }
    finally { setBusy(false); }
  };

  const finish = () => save(true);
  const skipAll = () => save(true);


  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-5 pt-6 pb-2">
        <div className="flex items-center gap-2 mb-2">
          {steps.map((_, i) => (
            <div key={i} className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
              <motion.div
                initial={false}
                animate={{ width: i <= step ? "100%" : "0%" }}
                transition={{ duration: 0.4 }}
                className="h-full bg-gradient-to-r from-electric-purple to-energy"
              />
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Step {step + 1} of {total}</span>
          <div className="flex items-center gap-3">
            {step < total - 1 && <button onClick={() => setStep(step + 1)} className="hover:text-foreground">Skip step</button>}
            <button onClick={skipAll} disabled={busy} className="text-electric-purple font-medium hover:opacity-80">Skip setup →</button>
          </div>
        </div>
      </div>

      <div className="flex-1 px-5 pt-6 max-w-md w-full mx-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}
            transition={{ duration: 0.25 }}
          >
            <div className="flex items-center gap-2 mb-1 text-electric-purple">
              {cur.key === "sport" && <Activity className="h-5 w-5" />}
              {cur.key === "level" && <Sparkles className="h-5 w-5" />}
              {cur.key === "goal" && <Target className="h-5 w-5" />}
              {cur.key === "days" && <Calendar className="h-5 w-5" />}
              {cur.key === "age" && <Cake className="h-5 w-5" />}
              {cur.key === "country" && <MapPin className="h-5 w-5" />}
              {cur.key === "preview" && <Rocket className="h-5 w-5" />}
            </div>
            <h1 className="text-2xl font-bold mb-1">{cur.title}</h1>
            <p className="text-sm text-muted-foreground mb-6">{cur.subtitle}</p>

            {cur.key === "sport" && (
              <div className="grid grid-cols-2 gap-2">
                {SPORTS.map((s) => (
                  <button key={s} onClick={() => setData({ ...data, sport: s })}
                    className={`p-3 rounded-xl border text-sm font-medium transition ${data.sport === s ? "bg-electric-purple/20 border-electric-purple" : "border-border bg-card hover:border-electric-purple/40"}`}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            {cur.key === "level" && (
              <div className="space-y-2">
                {LEVELS.map((l) => (
                  <button key={l} onClick={() => setData({ ...data, level: l })}
                    className={`w-full p-4 rounded-xl border text-start font-medium transition ${data.level === l ? "bg-electric-purple/20 border-electric-purple" : "border-border bg-card hover:border-electric-purple/40"}`}>
                    {l}
                  </button>
                ))}
              </div>
            )}

            {cur.key === "goal" && (
              <div className="grid grid-cols-2 gap-2">
                {GOALS.map((g) => (
                  <button key={g} onClick={() => setData({ ...data, goal: g })}
                    className={`p-3 rounded-xl border text-sm font-medium transition ${data.goal === g ? "bg-electric-purple/20 border-electric-purple" : "border-border bg-card hover:border-electric-purple/40"}`}>
                    {g}
                  </button>
                ))}
              </div>
            )}

            {cur.key === "days" && (
              <div className="grid grid-cols-3 gap-2">
                {DAYS.map((d) => (
                  <button key={d} onClick={() => setData({ ...data, days: d })}
                    className={`p-6 rounded-xl border font-bold text-2xl transition ${data.days === d ? "bg-electric-purple/20 border-electric-purple text-electric-purple" : "border-border bg-card hover:border-electric-purple/40"}`}>
                    {d}
                  </button>
                ))}
              </div>
            )}

            {cur.key === "age" && (
              <div className="space-y-3">
                <Input
                  type="date"
                  inputMode="numeric"
                  value={data.dob}
                  min={earliestDob()}
                  max={localDateKey()}
                  onChange={(e) => setData({ ...data, dob: e.target.value })}
                  className="h-12"
                  aria-label="Date of birth"
                />
                {validateDob(data.dob) ? (
                  <p className="text-xs text-destructive">{validateDob(data.dob)}</p>
                ) : data.dob ? (
                  <p className="text-xs text-muted-foreground">
                    {ageBand(data.dob) === "adult"
                      ? "Thanks — your account is set up as an adult."
                      : "Under 18: your account stays ad-free, and training loads are capped for your age."}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Optional. You can add or change this later in Profile — until then, no sponsored content
                    is shown, and no age-based training adjustments are applied.
                  </p>
                )}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Sponsored content is only shown to athletes aged 18 or over. It is always labelled, and no
                  brand ever sees your training data.
                </p>
              </div>
            )}

            {cur.key === "country" && (
              <div className="space-y-3">
                <CountrySelect
                  value={normaliseCountryCode(data.country)}
                  onChange={(code) => setData({ ...data, country: code ?? "" })}
                  allowClear={false}
                />
                {normaliseCountryCode(data.country) && (
                  <p className="text-xs text-muted-foreground">
                    {countryName(data.country)} · {continentFor(data.country)}. You'll rank on both boards.
                  </p>
                )}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Your country is shown next to your name on leaderboards. Your exact location is never
                  collected, and you can change this in Profile at any time.
                </p>
              </div>
            )}

            {cur.key === "preview" && (
              <div className="space-y-3">
                <Input placeholder="Your name (optional)" value={data.name} onChange={(e) => setData({ ...data, name: e.target.value })} className="h-12" />
                <div className="p-4 rounded-2xl bg-gradient-to-br from-electric-purple/20 to-energy/10 border border-electric-purple/40">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Your plan</p>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Sport</span><span className="font-medium">{data.sport}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Level</span><span className="font-medium">{data.level}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Goal</span><span className="font-medium">{data.goal}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Days/week</span><span className="font-medium">{data.days}</span></div>
                    {normaliseCountryCode(data.country) && (
                      <div className="flex justify-between"><span className="text-muted-foreground">Country</span><span className="font-medium">{countryName(data.country)}</span></div>
                    )}
                    {data.dob && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Age</span>
                        <span className="font-medium">
                          {ageBand(data.dob) === "adult" ? "18+" : "Under 18 (ad-free)"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground text-center">Plus 14 days of Pro on the house.</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="p-5 max-w-md w-full mx-auto flex gap-2">
        {step > 0 && (
          <Button variant="outline" onClick={() => setStep(step - 1)} className="h-12 px-4">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}
        <Button
          onClick={step === total - 1 ? finish : () => setStep(step + 1)}
          disabled={!canContinue() || busy}
          className="flex-1 h-12 bg-gradient-to-r from-electric-purple to-energy font-semibold"
        >
          {step === total - 1 ? (busy ? "Setting up..." : "Enter Vaylo Sports") : "Continue"}
          {step < total - 1 && <ChevronRight className="h-4 w-4 ml-1" />}
        </Button>
      </div>
    </div>
  );
}
