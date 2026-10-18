import { useState, useEffect, useRef } from "react";
import { motion, useInView } from "framer-motion";
import {
  User,
  Users,
  Settings,
  ChevronRight,
  Zap,
  Globe,
  LogOut,
  Medal,
  Ruler,
  Weight,
  Target,
  Calendar,
  Trash2,
  MapPin,
  MessageCircle,
  Scale,
  Bell,
  Watch,
  FileText,
  ShieldCheck,
  Flame,
  Gift,
} from "lucide-react";
import { discordInviteUrl } from "@/config/community";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatSports } from "@/lib/profile";
import AccountSubscriptionCard from "@/components/subscription/AccountSubscriptionCard";
import PersonalizationSetting from "@/components/settings/PersonalizationSetting";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { isAndroid } from "@/lib/platform";
import { isFlagOn } from "@/config/featureFlags";
import HealthConnectPrompt from "@/components/health/HealthConnectPrompt";
import XpSummaryCard from "@/components/xp/XpSummaryCard";
import CountrySelect from "@/components/geo/CountrySelect";
import LanguageSetting from "@/components/settings/LanguageSetting";
import PasskeysSetting from "@/components/settings/PasskeysSetting";
import {
  continentFor,
  countryName,
  currencyFor,
  normaliseCountryCode,
} from "@/lib/geo";
import { legalPath } from "@/lib/legalUrls";
import ProfilePicture from "@/components/profile/ProfilePicture";

// Profile is the account hub. The wardrobe (titles, borders, names, effects,
// achieved badges) has been removed: it was an orphaned second surface for
// coins-only cosmetics, not another coin destination. Coins are unaffected.
const Profile = () => {
  const { profile, user, signOut, refreshProfile } = useAuth();
  const { entitlements, hasUnlimitedCredits } = useSubscription();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [showSettings, setShowSettings] = useState(false);

  // Health Connect is managed from here, in the sheet below. The separate
  // Wearables screen was removed; this row is the one door to it.
  const [showHealthConnect, setShowHealthConnect] = useState(false);
  const wearableOffer = isAndroid() && isFlagOn("wearableSync");

  const [currency, setCurrency] = useState("USD");
  // ISO alpha-2, stored in `user_region` — the table the leaderboards read.
  const [country, setCountry] = useState<string | null>(null);
  const [waterGoal, setWaterGoal] = useState("3000");
  const [showWaterEdit, setShowWaterEdit] = useState(false);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const menuRef = useRef(null);
  const menuInView = useInView(menuRef, { once: true, margin: "-30px" });

  // Edit profile state
  const [editWeight, setEditWeight] = useState("");
  const [editHeight, setEditHeight] = useState("");
  const [editExperience, setEditExperience] = useState("");
  const [editGoals, setEditGoals] = useState<string[]>([]);
  const [editSport, setEditSport] = useState("");
  const [editDob, setEditDob] = useState("");

  useEffect(() => {
    if (user) {
      supabase
        .from("user_settings")
        .select("currency, water_goal_ml")
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.currency) setCurrency(data.currency);
          if (data?.water_goal_ml) setWaterGoal(String(data.water_goal_ml));
        });
      supabase
        .from("user_region")
        .select("country")
        .eq("user_id", user.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.country) setCountry(data.country);
        });
    }
  }, [user]);

  useEffect(() => {
    if (profile) {
      setEditWeight(profile.weight_kg ? String(profile.weight_kg) : "");
      setEditHeight(profile.height_cm ? String(profile.height_cm) : "");
      setEditExperience(profile.experience_level || "");
      setEditGoals(profile.goals || []);
      setEditSport(profile.sport || "");
      setEditDob(profile.date_of_birth || "");
    }
  }, [profile]);

  const saveCurrency = async (val: string) => {
    if (!user) return;
    setCurrency(val);
    const { error } = await supabase
      .from("user_settings")
      .upsert({ user_id: user.id, currency: val }, { onConflict: "user_id" });
    if (error) {
      toast({
        title: "Couldn't save your currency",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: `Currency set to ${val}` });
  };

  const saveCountry = async (code: string | null) => {
    if (!user) return;
    const normalised = normaliseCountryCode(code);
    if (!normalised) {
      toast({ title: "Pick a country from the list", variant: "destructive" });
      return;
    }
    const previous = country;
    setCountry(normalised);
    // `currency` here is the pricing tier that follows the country, and is a
    // different thing from the display currency in Settings above.
    const { error } = await supabase
      .from("user_region")
      .upsert(
        {
          user_id: user.id,
          country: normalised,
          currency: currencyFor(normalised) ?? "USD",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (error) {
      setCountry(previous);
      toast({
        title: "Couldn't save your country",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({
      title: `${countryName(normalised)} saved`,
      description: `You now rank on the ${countryName(normalised)} and ${continentFor(normalised)} leaderboards.`,
    });
  };

  const saveWaterGoal = async () => {
    if (!user) return;
    const goal = parseInt(waterGoal) || 3000;
    const { error } = await supabase
      .from("user_settings")
      .upsert({ user_id: user.id, water_goal_ml: goal }, { onConflict: "user_id" });
    if (error) {
      toast({
        title: "Couldn't save your water goal",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setShowWaterEdit(false);
    toast({ title: "Water goal updated!" });
  };

  const saveProfileEdits = async () => {
    if (!user) return;
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        weight_kg: editWeight ? parseFloat(editWeight) : null,
        height_cm: editHeight ? parseFloat(editHeight) : null,
        experience_level: editExperience || null,
        goals: editGoals.length > 0 ? editGoals : null,
        sport: editSport || null,
        date_of_birth: editDob || null,
      })
      .eq("user_id", user.id);
    if (updateError) {
      toast({
        title: "Couldn't update your profile",
        description: updateError.message,
        variant: "destructive",
      });
      return;
    }
    await refreshProfile();
    setShowEditProfile(false);
    toast({ title: "Profile updated" });
  };

  const toggleGoal = (g: string) => {
    setEditGoals((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
    );
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const handleDeleteAccount = () => navigate("/settings/delete-account");

  // destinations an athlete looked for in the drawer but which were only ever
  // reachable from it on mobile (notifications) or buried one level down.
  const menuItems: {
    icon: typeof Settings;
    label: string;
    desc: string;
    path?: string;
    onClick?: () => void;
  }[] = [
    // Written as an explicit handler rather than `path` so this one row is
    // greppable as the app's legal entry point — safetyCompliance.test.ts
    // asserts this exact call is present in this file, which is the cheapest
    // possible guard against the row being quietly dropped in a refactor.
    {
      icon: Scale,
      label: "Legal & Safety",
      desc: "All 26 policies, your rights, and reporting",
      onClick: () => navigate("/legal"),
    },
    {
      icon: Bell,
      label: "Notifications",
      desc: "Your alerts and what may be sent",
      path: "/notifications",
    },
    // Android + launch flag only — on any other build there is no Health
    // Connect to manage, and a row leading to an explanation is worse than no
    // row. The sheet itself gates too; this is what keeps it out of the list.
    ...(wearableOffer
      ? [
          {
            icon: Watch,
            label: "Health Connect",
            desc: "Connect, sync and manage your health data",
            onClick: () => setShowHealthConnect(true),
          },
        ]
      : []),
    // Friends is back on this screen. The surface itself never went away — /friends
    // is a real page with the friend graph, messages and sharing behind it — but
    // after the drawer's mobile entry point was removed its only remaining door
    // was the sidebar, which a phone cannot open. That made a working feature
    // effectively invisible: "friends" read as deleted because there was no way
    // in. The Profile tab is always one tap away, so this is the door.
    {
      icon: Users,
      label: "Friends",
      desc: "Connect, message and share sessions",
      path: "/friends",
    },
    // Achievements lived here until 2026-10-10. They now live in the Perform
    // hub's Trophy Room (/achievements, /challenges) — they are earned by
    // performing, so that is where an athlete looks for them. The sidebar
    // still links /achievements directly, so nothing is unreachable.
    {
      icon: Zap,
      label: "Market",
      desc: "Credits, subscriptions & features",
      path: "/market",
    },
    {
      icon: Flame,
      label: "Streaks",
      desc: "Your streak, milestones and rewards",
      path: "/streaks",
    },
    {
      icon: Gift,
      label: "Refer & earn",
      desc: "Invite friends, track rewards",
      path: "/referrals",
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* pt uses the shared top-gutter token: with the header row gone there is
          nothing above this title but the status bar inset, and the token is
          what keeps that true on every screen rather than per-page guesswork. */}
      <div className="px-5 pt-[var(--vaylo-screen-top)] pb-[var(--vaylo-title-gap)]">
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-display font-bold"
        >
          Profile
        </motion.h1>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="mx-5 mb-5 border border-border rounded-2xl p-5 card-surface"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <ProfilePicture />
            <div className="min-w-0">
              <h2 className="font-display font-bold text-lg truncate">
                {profile?.full_name || "Athlete"}
              </h2>
              <p className="text-sm text-muted-foreground">
                {formatSports(profile?.sport)} · {profile?.experience_level || "Intermediate"}
              </p>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-[12px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">
                  {entitlements.plan_label}
                </span>
                <span className="text-[12px] bg-energy/10 text-energy px-2 py-0.5 rounded-full font-semibold">
                  {hasUnlimitedCredits
                    ? "Unlimited credits"
                    : `${profile?.credits ?? 0} credits`}
                </span>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      <div className="px-5 mb-5">
        <AccountSubscriptionCard />
      </div>

      {/* Athlete progression: level, XP total, next-level progress and recent
          XP. Progression only — no money, no shop, no leaderboard. */}
      <XpSummaryCard />

      {/* One card for every destination and every setting. `divide-y` supplies
          the separators, so a row can never drift back to being its own card,
          and the expanded panels sit inside the card rather than hanging off it
          as a second box. */}
      <div ref={menuRef} className="px-5 mb-5">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={menuInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.35 }}
          className="card-surface divide-y divide-white/[0.06] overflow-hidden"
        >
          {menuItems.map((item) => (
            <Row
              key={item.label}
              icon={item.icon}
              label={item.label}
              desc={item.desc}
              onClick={() =>
                item.onClick ? item.onClick() : navigate(item.path as string)
              }
              expanded={false}
              rotate={false}
            />
          ))}

          {discordInviteUrl() && (
            <Row
              icon={MessageCircle}
              label="Community"
              desc="Train together on Discord"
              onClick={() => navigate("/discord")}
              expanded={false}
              rotate={false}
            />
          )}

          <Row
            icon={User}
            label="Edit profile"
            desc="Weight, height, goals, sport, date of birth"
            onClick={() => setShowEditProfile((v) => !v)}
            expanded={showEditProfile}
          />
          {showEditProfile && (
            <Panel>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                    <Weight size={12} /> Weight (kg)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={editWeight}
                    onChange={(e) => setEditWeight(e.target.value)}
                    className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-sm"
                    placeholder="70"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                    <Ruler size={12} /> Height (cm)
                  </label>
                  <input
                    type="number"
                    value={editHeight}
                    onChange={(e) => setEditHeight(e.target.value)}
                    className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-sm"
                    placeholder="175"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                  <Calendar size={12} /> Date of Birth
                </label>
                <input
                  type="date"
                  value={editDob}
                  onChange={(e) => setEditDob(e.target.value)}
                  className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Experience Level
                </label>
                <div className="flex gap-1.5">
                  {experienceLevels.map((l) => (
                    <button
                      key={l}
                      onClick={() => setEditExperience(l)}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium capitalize border transition-all ${
                        editExperience === l
                          ? "bg-primary/15 border-primary text-primary"
                          : "bg-card border-border text-foreground"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Sport</label>
                <div className="flex flex-wrap gap-1.5">
                  {sportOptions.map((s) => (
                    <button
                      key={s}
                      onClick={() => setEditSport(s)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                        editSport === s
                          ? "bg-primary/15 border-primary text-primary"
                          : "bg-card border-border text-foreground"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1">
                  <Target size={12} /> Goals
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {goalOptions.map((g) => (
                    <button
                      key={g}
                      onClick={() => toggleGoal(g)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                        editGoals.includes(g)
                          ? "bg-electric-purple/15 border-electric-purple text-electric-purple"
                          : "bg-card border-border text-foreground"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
              {/* Flat primary, not a gradient with a halo. Nine gradient CTAs on
                  one screen is what made this look generated; a solid one is
                  also the easier target to hit. */}
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={saveProfileEdits}
                className="w-full bg-primary text-primary-foreground font-semibold py-3 rounded-xl"
              >
                Save changes
              </motion.button>
            </Panel>
          )}

          <Row
            icon={Settings}
            label="Settings"
            desc="Language, passkeys, country, currency, water goal"
            onClick={() => setShowSettings((v) => !v)}
            expanded={showSettings}
          />
          {showSettings && (
            <Panel>
              <div>
                <LanguageSetting />
              </div>
              <PasskeysSetting />
              <div>
                <label className="text-xs text-muted-foreground mb-2 block flex items-center gap-1">
                  <MapPin size={12} /> Country
                </label>
                <CountrySelect value={country} onChange={saveCountry} />
                <p className="text-[12px] text-muted-foreground mt-2">
                  {country
                    ? `${countryName(country)} · ${continentFor(country)}. Shown next to your name on leaderboards.`
                    : "Set this to appear on your country and continental leaderboards."}
                </p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-2 block flex items-center gap-1">
                  <Globe size={12} /> Currency
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {currencies.map((c) => (
                    <button
                      key={c}
                      onClick={() => saveCurrency(c)}
                      className={`press px-3 py-2 rounded-lg text-xs font-medium border transition-all ${
                        currency === c
                          ? "bg-primary/15 border-primary text-primary"
                          : "bg-white/[0.03] border-white/[0.08] text-foreground"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-2 block flex items-center gap-1">
                  <Ruler size={12} /> Daily Water Goal (ml)
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="10"
                    value={waterGoal}
                    onChange={(e) => setWaterGoal(e.target.value)}
                    className="flex-1 bg-muted border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/50 focus:outline-none"
                  />
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={saveWaterGoal}
                    className="bg-primary text-primary-foreground px-4 rounded-xl text-sm font-semibold"
                  >
                    Save
                  </motion.button>
                </div>
              </div>

              {/* The two URLs Google Play names explicitly, kept as direct
                  shortcuts inside Settings as well as reachable from the Legal
                  & Safety row above. Play's data-safety form points at the
                  privacy policy and the account-deletion page, and an athlete
                  looking for either should not have to find the document index
                  first. Both open in the app's own document viewer, so they never lose the
                  athlete's place in the app.

                  There is deliberately no "Delete account" row here. The same
                  irreversible action already exists once, as a full-width
                  button under a plain-language warning at the foot of this
                  screen, and having it in two places on one screen is a mistake
                  waiting to happen. */}
              <div className="space-y-1 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => navigate(legalPath("privacy"))}
                  className="w-full flex items-center justify-between gap-2 py-1.5 text-foreground hover:text-primary transition-colors"
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <ShieldCheck size={16} /> Privacy Policy
                  </span>
                  <ChevronRight
                    size={16}
                    className="text-muted-foreground rtl-flip"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => navigate(legalPath("terms"))}
                  className="w-full flex items-center justify-between gap-2 py-1.5 text-foreground hover:text-primary transition-colors"
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <FileText size={16} /> Terms of Service
                  </span>
                  <ChevronRight
                    size={16}
                    className="text-muted-foreground rtl-flip"
                  />
                </button>
              </div>

              {/* The live AI self-test used to sit at the foot of Settings. It was
                  a developer diagnostic on an athlete's own settings screen, and
                  it has been removed (owner request, 2026-10-11) — a support tool
                  that asks a customer to press "Run AI test" is a question they
                  should never have been asked. */}
            </Panel>
          )}
        </motion.div>
      </div>

      {/* Personalisation — one toggle: tailored app vs. everything */}
      <div className="px-5 mb-5">
        <PersonalizationSetting />
      </div>

      {/* Sign Out */}
      <div className="px-5 mb-3">
        <motion.button
          onClick={handleSignOut}
          whileTap={{ scale: 0.98 }}
          className="w-full flex items-center justify-center gap-2 bg-destructive/10 text-destructive font-semibold py-3 rounded-xl hover:bg-destructive/20 transition-colors"
        >
          <LogOut size={18} /> Sign Out
        </motion.button>
      </div>

      {/* Delete Account */}
      <div className="px-5 mb-8">
        <motion.button
          onClick={handleDeleteAccount}
          whileTap={{ scale: 0.98 }}
          className="w-full flex items-center justify-center gap-2 border border-destructive/40 text-destructive font-semibold py-3 rounded-xl hover:bg-destructive/10 transition-colors text-sm"
        >
          <Trash2 size={16} /> Delete account permanently
        </motion.button>
        <p className="text-[12px] text-muted-foreground text-center mt-2">
          Wipes all training data, goals, purchases and credits. Cannot be undone.
        </p>
      </div>

      <HealthConnectPrompt open={showHealthConnect} onClose={() => setShowHealthConnect(false)} />
    </div>
  );
};

const experienceLevels = ["beginner", "intermediate", "advanced", "elite"];
const sportOptions = [
  "Running", "Gym/Weightlifting", "Football", "Basketball", "Swimming", "Cycling",
  "Tennis", "Rugby", "Boxing", "MMA", "Cricket", "Athletics", "Triathlon",
  "CrossFit", "General",
];
const currencies = [
  "USD", "EUR", "GBP", "AUD", "CAD", "JPY", "INR", "BRL", "ZAR", "NZD",
  "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "MXN", "SGD", "HKD",
];
const goalOptions = [
  "Speed", "Strength", "Endurance", "Fat Loss", "Muscle Gain", "Power",
  "Agility", "VO2 Max", "Lactate Threshold", "Flexibility", "Mobility",
  "Explosiveness", "Balance", "Coordination", "Reaction Time", "Injury Recovery",
  "Mental Toughness", "Sport Skill", "Event Prep", "Longevity",
  "Body Recomposition", "Cross-Training", "Technique", "Confidence", "Consistency",
];

const Row = ({
  icon: Icon,
  label,
  desc,
  onClick,
  expanded,
  rotate = true,
}: {
  icon: typeof Settings;
  label: string;
  desc: string;
  onClick: () => void;
  expanded?: boolean;
  /** Set false for rows that navigate rather than expand. */
  rotate?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-expanded={expanded}
    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.04] active:bg-white/[0.06] press`}
  >
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary">
      <Icon size={16} className="text-foreground" aria-hidden />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-semibold">{label}</span>
      <span className="block truncate text-xs text-muted-foreground">{desc}</span>
    </span>
    <motion.span
      animate={{ rotate: expanded ? 90 : 0 }}
      transition={{ duration: 0.15 }}
      className="shrink-0"
      aria-hidden
    >
      <ChevronRight size={16} className="text-muted-foreground rtl-flip" />
    </motion.span>
  </button>
);

/** The panel an expanded row reveals. Sits inside the card, under its row. */
const Panel = ({ children }: { children: React.ReactNode }) => (
  <motion.div
    initial={{ opacity: 0, height: 0 }}
    animate={{ opacity: 1, height: "auto" }}
    transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
    className="overflow-hidden"
  >
    <div className="space-y-4 px-4 pb-4 pt-1">{children}</div>
  </motion.div>
);

export default Profile;
