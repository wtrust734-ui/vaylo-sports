import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Arcade() {
  const { t } = useTranslation();
  const [score, setScore] = useState<number | null>(null);

  return (
    <div className="min-h-screen pb-28">
      <div className="px-5 pt-[var(--vaylo-screen-top)]">
        <Card>
          <CardHeader>
            <CardTitle>{t ? t("arcade.title") : "Arcade"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center py-8">
              <p className="text-5xl font-display font-bold text-primary">🎮</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {t
                  ? t("arcade.intro")
                  : "Mini games, challenges and leaderboards. Play for fun — nothing here is gated or charged."}
              </p>
            </div>
            <Button onClick={() => setScore((s) => (s ?? 0) + 1)}>
              {t ? t("arcade.play") : "Play a game"}
            </Button>
            {score !== null && (
              <p className="text-center text-sm text-muted-foreground">
                {t ? t("arcade.score", { score }) : `You scored ${score} points!`}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
