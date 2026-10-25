import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function EventPacks() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="min-h-screen pb-28">
      <div className="px-5 pt-[var(--vaylo-screen-top)]">
        <Card>
          <CardHeader>
            <CardTitle>{t ? t("events.title") : "Events"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t
                ? t("events.description")
                : "Seasonal events, challenges and limited-time activities. Nothing is charged — everything is free to join."}
            </p>
            <div className="grid grid-cols-1 gap-3">
              <Button variant="default" onClick={() => setSelected("season")}>
                {t ? t("events.season") : "This season's event"}
              </Button>
              <Button variant="outline" onClick={() => setSelected("weekly")}>
                {t ? t("events.weekly") : "Weekly challenge"}
              </Button>
            </div>
            {selected && (
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="font-semibold">
                  {t
                    ? t("events.title", { type: selected })
                    : `Selected: ${selected}`}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t
                    ? t("events.level", { level: "Open to everyone — join anytime" })
                    : "Level: Open to everyone — join anytime"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
