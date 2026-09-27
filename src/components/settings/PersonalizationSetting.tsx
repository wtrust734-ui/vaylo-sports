import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { isShowAllEnabled, setShowAllEnabled } from "@/lib/personalization/engine";
import { useAthleteProfile } from "@/hooks/usePersonalization";

/**
 * The personalisation escape hatch. When "Tailor my app" is ON (the default
 * once a sport is set) the athlete sees a filtered, ordered app. Turning it
 * off restores every surface — nobody gets trapped by our guesses.
 */
const PersonalizationSetting = () => {
  const athlete = useAthleteProfile();
  const [tailored, setTailored] = useState(true);

  useEffect(() => {
    setTailored(!isShowAllEnabled());
  }, []);

  const relevantCount = athlete.sports.length > 0 ? "your sports" : "everything";

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
          <SlidersHorizontal size={16} className="text-primary" />
        </div>
        <div>
          <h4 className="text-sm font-semibold">Tailor my app</h4>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Show the surfaces that matter for {relevantCount}. Off = everything.
          </p>
        </div>
      </div>
      <Switch
        checked={tailored}
        onCheckedChange={(on) => {
          setTailored(on);
          setShowAllEnabled(!on);
        }}
        aria-label="Tailor my app"
      />
    </div>
  );
};

export default PersonalizationSetting;
