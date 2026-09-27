import { useState, useEffect, useRef } from "react";
import { motion, useInView } from "framer-motion";
import { User, Medal, Settings, ChevronRight, Zap, Users, Globe, LogOut, Ruler, Weight, Target, Heart, Calendar, Trash2, MapPin, MessageCircle } from "lucide-react";
import { discordInviteUrl } from "@/config/community";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatSports } from "@/lib/profile";
import AIConnectionTest from "@/components/AIConnectionTest";
import AccountSubscriptionCard from "@/components/subscription/AccountSubscriptionCard";
import { useSubscription } from "@/contexts/SubscriptionContext";
import CosmeticShop from "@/components/profile/CosmeticShop";
import { cosmeticColor, cosmeticLabel, isAnimated, useCosmetics } from "@/lib/cosmetics";
import { Sparkles } from "lucide-react";
import CountrySelect from "@/components/geo/CountrySelect";
import LanguageSetting from "@/components/settings/LanguageSetting";
import PasskeysSetting from "@/components/settings/PasskeysSetting";
import { continentFor, countryName, currencyFor, normaliseCountryCode } from "@/lib/geo";


const currencies = ["USD", "EUR", "GBP", "AUD", "CAD", "JPY", "INR", "BRL", "ZAR", "NZD", "CHF", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "MXN", "SGD", "HKD"];
const goalOptions = [
  "Speed", "Strength", "Endurance", "Fat Loss", "Muscle Gain", "Power", "Agility",
  "VO2 Max", "Lactate Threshold", "Flexibility", "Mobility", "Explosiveness",
  "Balance", "Coordination", "Reaction Time", "Injury Recovery", "Mental Toughness",
  "Sport Skill", "Event Prep", "Longevity", "Body Recomposition", "Cross-Training",
  "Technique", "Confidence", "Consistency",
];
const experienceLevels = ["beginner", "intermediate", "advanced", "elite"];
const sportOptions = ["Running", "Gym/Weightlifting", "Football", "Basketball", "Swimming", "Cycling", "Tennis", "Rugby", "Boxing", "MMA", "Cricket", "Athletics", "Triathlon", "CrossFit", "General"];

const Profile = () => {
  const { profile, user, signOut, refreshProfile } = useAuth();
  const { entitlements, hasUnlimitedCredits } = useSubscription();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [showSettings, setShowSettings] = useState(false);
  const [showCosmetics, setShowCosmetics] = useState(false);
  const { equippedDefs } = useCosmetics();
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
      supabase.from("user_settings").select("currency, water_goal_ml").eq("user_id", user.id).maybeSingle()
        .then(({ data }) => {
          if (data?.currency) setCurrency(data.currency);
          if (data?.water_goal_ml) setWaterGoal(String(data.water_goal_ml));
        });
      supabase.from("user_region").select("country").eq("user_id", user.id).maybeSingle()
        .then(({ data }) => { if (data?.country) setCountry(data.country); });
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
    const { error } = await supabase.from("user_settings").upsert({ user_id: user.id, currency: val }, { onConflict: "user_id" });
    if (error) { toast({ title: "Couldn't save your currency", description: error.message, variant: "destructive" }); return; }
    toast({ title: `Currency set to ${val}` });
  };

  const saveCountry = async (code: string | null) => {
    if (!user) return;
    const normalised = normaliseCountryCode(code);
    if (!normalised) { toast({ title: "Pick a country from the list", variant: "destructive" }); return; }
    const previous = country;
    setCountry(normalised);
    // `currency` here is the pricing tier that follows the country, and is a
    // different thing from the display currency in Settings above.
    const { error } = await supabase.from("user_region").upsert({
      user_id: user.id,
      country: normalised,
      currency: currencyFor(normalised) ?? "USD",
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) {
      setCountry(previous);
      toast({ title: "Couldn't save your country", description: error.message, variant: "destructive" });
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
    const { error } = await supabase.from("user_settings").upsert({ user_id: user.id, water_goal_ml: goal }, { onConflict: "user_id" });
    if (error) { toast({ title: "Couldn't save your water goal", description: error.message, variant: "destructive" }); return; }
    setShowWaterEdit(false);
    toast({ title: "Water goal updated!" });
  };

  const saveProfileEdits = async () => {
    if (!user) return;
    const { error: updateError } = await supabase.from("profiles").update({
      weight_kg: editWeight ? parseFloat(editWeight) : null,
      height_cm: editHeight ? parseFloat(editHeight) : null,
      experience_level: editExperience || null,
      goals: editGoals.length > 0 ? editGoals : null,
      sport: editSport || null,
      date_of_birth: editDob || null,
    }).eq("user_id", user.id);
    if (updateError) { toast({ title: "Couldn't update your profile", description: updateError.message, variant: "destructive" }); return; }
    await refreshProfile();
    setShowEditProfile(false);
    toast({ title: "Profile updated! ✅" });
  };

  const toggleGoal = (g: string) => {
    setEditGoals(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const handleDeleteAccount = () => navigate("/settings/delete-account");


  const menuItems = [
    { icon: Medal, label: "Achievements", desc: "Badges, milestones & challenges", path: "/achievements" },
    { icon: Users, label: "Friends", desc: "Connect with athletes", path: "/friends" },
    { icon: Zap, label: "Market", desc: "Credits, subscriptions & features", path: "/market" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <div className="px-5 pt-14 pb-4">
        <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-2xl font-display font-bold">Profile</motion.h1>
      </div>

      <motion.div initial={{ opacity: 0, y: 20, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.5 }}
        className="mx-5 mb-5 bg-gradient-card border border-border rounded-2xl p-5 shadow-card">
        <div className="flex items-center gap-4">
          {/* The equipped border ring wraps the avatar. */}
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.2, type: "spring" }}
            className={`w-16 h-16 rounded-full bg-electric-purple/20 flex items-center justify-center ${equippedDefs.border_id ? "border-2" : ""}`}
            style={equippedDefs.border_id ? {
              borderColor: cosmeticColor(equippedDefs.border_id) ?? "hsl(var(--primary))",
              boxShadow: isAnimated(equippedDefs.border_id)
                ? "0 0 18px hsl(var(--primary) / 0.65)"
                : undefined,
            } : undefined}>
            <User size={28} className="text-electric-purple" />
          </motion.div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2
                className="font-display font-bold text-lg truncate"
                style={equippedDefs.name_color_id ? { color: cosmeticColor(equippedDefs.name_color_id) ?? undefined } : undefined}
              >
                {profile?.full_name || "Athlete"}
              </h2>
              {equippedDefs.badge_id && (
                <span title={cosmeticLabel(equippedDefs.badge_id)} className="shrink-0">
                  <Medal size={14} className="text-amber-400" />
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{formatSports(profile?.sport)} · {profile?.experience_level || "Intermediate"}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">{entitlements.plan_label}</span>
              <span className="text-[11px] bg-energy/10 text-energy px-2 py-0.5 rounded-full font-semibold">{hasUnlimitedCredits ? "Unlimited credits" : `${profile?.credits ?? 0} credits`}</span>
              {equippedDefs.title_id && (
                <span className="text-[11px] bg-electric-purple/10 text-electric-purple px-2 py-0.5 rounded-full font-semibold">
                  {cosmeticLabel(equippedDefs.title_id)}
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowCosmetics(true)}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl border border-border py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <Sparkles size={12} /> Cosmetics ({Object.keys(equippedDefs).length} equipped)
        </button>
      </motion.div>

      <div className="px-5 mb-5">
        <AccountSubscriptionCard />
      </div>

      {/* Community — hidden until VITE_DISCORD_INVITE_URL is configured. */}
      {discordInviteUrl() && (
        <div className="px-5 mb-5">
          <button
            onClick={() => navigate("/discord")}
            className="w-full bg-card border border-border rounded-xl p-4 flex items-center justify-between hover:border-electric-purple/20 transition-colors duration-300"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[#5865F2]/10"><MessageCircle size={18} className="text-[#5865F2]" /></div>
              <div className="text-left"><h4 className="font-semibold text-sm">Community</h4><p className="text-xs text-muted-foreground">Train together on Discord</p></div>
            </div>
            <ChevronRight size={16} className="text-muted-foreground rtl-flip" />
          </button>
        </div>
      )}

      {/* Edit Profile */}
      <div className="px-5 mb-5">
        <motion.button onClick={() => setShowEditProfile(!showEditProfile)} whileTap={{ scale: 0.98 }}
          className="w-full bg-card border border-border rounded-xl p-4 flex items-center justify-between hover:border-electric-purple/20 transition-colors duration-300">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-electric-purple/10"><User size={18} className="text-electric-purple" /></div>
            <div><h4 className="font-semibold text-sm">Edit Profile</h4><p className="text-xs text-muted-foreground">Weight, height, goals, sport, DOB</p></div>
          </div>
          <motion.div animate={{ rotate: showEditProfile ? 90 : 0 }}><ChevronRight size={16} className="text-muted-foreground rtl-flip" /></motion.div>
        </motion.button>
        {showEditProfile && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
            className="bg-card border border-border rounded-xl p-4 mt-2 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1"><Weight size={12} /> Weight (kg)</label>
                <input type="number" step="0.1" value={editWeight} onChange={e => setEditWeight(e.target.value)}
                  className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-sm" placeholder="70" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1"><Ruler size={12} /> Height (cm)</label>
                <input type="number" value={editHeight} onChange={e => setEditHeight(e.target.value)}
                  className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-sm" placeholder="175" />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1"><Calendar size={12} /> Date of Birth</label>
              <input type="date" value={editDob} onChange={e => setEditDob(e.target.value)}
                className="w-full bg-muted border border-border rounded-xl px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Experience Level</label>
              <div className="flex gap-1.5">
                {experienceLevels.map(l => (
                  <button key={l} onClick={() => setEditExperience(l)}
                    className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium capitalize border transition-all ${editExperience === l ? "bg-primary/15 border-primary text-primary" : "bg-card border-border text-foreground"}`}>{l}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Sport</label>
              <div className="flex flex-wrap gap-1.5">
                {sportOptions.map(s => (
                  <button key={s} onClick={() => setEditSport(s)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${editSport === s ? "bg-primary/15 border-primary text-primary" : "bg-card border-border text-foreground"}`}>{s}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block flex items-center gap-1"><Target size={12} /> Goals</label>
              <div className="flex flex-wrap gap-1.5">
                {goalOptions.map(g => (
                  <button key={g} onClick={() => toggleGoal(g)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${editGoals.includes(g) ? "bg-electric-purple/15 border-electric-purple text-electric-purple" : "bg-card border-border text-foreground"}`}>{g}</button>
                ))}
              </div>
            </div>
            <motion.button whileTap={{ scale: 0.95 }} onClick={saveProfileEdits}
              className="w-full bg-gradient-primary text-primary-foreground font-semibold py-3 rounded-xl shadow-glow">Save Changes</motion.button>
          </motion.div>
        )}
      </div>

      {/* Settings */}
      <div className="px-5 mb-5">
        <motion.button onClick={() => setShowSettings(!showSettings)} whileTap={{ scale: 0.98 }}
          className="w-full bg-card border border-border rounded-xl p-4 flex items-center justify-between hover:border-primary/20 transition-colors duration-300">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-secondary"><Settings size={18} className="text-foreground" /></div>
            <div><h4 className="font-semibold text-sm">Settings</h4><p className="text-xs text-muted-foreground">Country, currency, water goal</p></div>
          </div>
          <motion.div animate={{ rotate: showSettings ? 90 : 0 }}><ChevronRight size={16} className="text-muted-foreground rtl-flip" /></motion.div>
        </motion.button>
        {showSettings && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
            className="bg-card border border-border rounded-xl p-4 mt-2 space-y-4">
            <div>
              <LanguageSetting />
            </div>
            <PasskeysSetting />
            <div>
              <label className="text-xs text-muted-foreground mb-2 block flex items-center gap-1"><MapPin size={12} /> Country</label>
              <CountrySelect value={country} onChange={saveCountry} />
              <p className="text-[11px] text-muted-foreground mt-2">
                {country
                  ? `${countryName(country)} · ${continentFor(country)}. Shown next to your name on leaderboards.`
                  : "Set this to appear on your country and continental leaderboards."}
              </p>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-2 block flex items-center gap-1"><Globe size={12} /> Currency</label>
              <div className="flex flex-wrap gap-1.5">
                {currencies.map(c => (
                  <button key={c} onClick={() => saveCurrency(c)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${currency === c ? "bg-primary/15 border-primary text-primary" : "bg-card border-border text-foreground"}`}>{c}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-2 block flex items-center gap-1"><Ruler size={12} /> Daily Water Goal (ml)</label>
              <div className="flex gap-2">
                <input type="number" step="10" value={waterGoal} onChange={e => setWaterGoal(e.target.value)}
                  className="flex-1 bg-muted border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:ring-2 focus:ring-primary/50 focus:outline-none" />
                <motion.button whileTap={{ scale: 0.95 }} onClick={saveWaterGoal} className="bg-primary text-primary-foreground px-4 rounded-xl text-sm font-semibold">Save</motion.button>
              </div>
            </div>
            <div className="pt-3 border-t border-border">
              <motion.button whileTap={{ scale: 0.98 }} onClick={handleDeleteAccount}
                className="w-full flex items-center justify-between gap-2 text-destructive">
                <span className="flex items-center gap-2 text-sm font-semibold"><Trash2 size={16} /> Delete Account</span>
                <ChevronRight size={16} />
              </motion.button>
              <p className="text-[11px] text-muted-foreground mt-1">Permanently erase your account and all personal data.</p>
            </div>
          </motion.div>
        )}
      </div>

      <div className="px-5 mb-5">
        <AIConnectionTest />
      </div>

      <div ref={menuRef} className="px-5 space-y-3 mb-5">

        {menuItems.map((item, i) => (
          <motion.div key={item.label} initial={{ opacity: 0, x: -15 }} animate={menuInView ? { opacity: 1, x: 0 } : {}}
            transition={{ delay: i * 0.08, duration: 0.4 }}
            whileHover={{ x: 4 }}
            onClick={() => navigate(item.path)}
            className="bg-card border border-border rounded-xl p-4 flex items-center justify-between cursor-pointer hover:border-primary/20 transition-colors duration-300">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-secondary"><item.icon size={18} className="text-foreground" /></div>
              <div><h4 className="font-semibold text-sm">{item.label}</h4><p className="text-xs text-muted-foreground">{item.desc}</p></div>
            </div>
            <ChevronRight size={16} className="text-muted-foreground rtl-flip" />
          </motion.div>
        ))}
      </div>

      {/* Sign Out */}
      <div className="px-5 mb-3">
        <motion.button onClick={handleSignOut} whileTap={{ scale: 0.98 }}
          className="w-full flex items-center justify-center gap-2 bg-destructive/10 text-destructive font-semibold py-3 rounded-xl hover:bg-destructive/20 transition-colors">
          <LogOut size={18} /> Sign Out
        </motion.button>
      </div>

      {/* Delete Account */}
      <div className="px-5 mb-8">
        <motion.button onClick={handleDeleteAccount} whileTap={{ scale: 0.98 }}
          className="w-full flex items-center justify-center gap-2 border border-destructive/40 text-destructive font-semibold py-3 rounded-xl hover:bg-destructive/10 transition-colors text-sm">
          <Trash2 size={16} /> Delete account permanently
        </motion.button>
        <p className="text-[11px] text-muted-foreground text-center mt-2">Wipes all training data, goals, purchases and credits. Cannot be undone.</p>
      </div>

      <CosmeticShop open={showCosmetics} onClose={() => setShowCosmetics(false)} />
    </div>
  );
};

export default Profile;
