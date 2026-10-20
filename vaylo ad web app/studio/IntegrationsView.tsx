import { useEffect, useState } from "react";
import { Plug, Loader2, AlertCircle, CheckCircle2, ShieldQuestion } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { fetchIntegrations, type IntegrationStatus } from "./api";

const CARD = "bg-white/5 border border-white/10";

export default function IntegrationsView() {
  const [data, setData] = useState<{ integrations: IntegrationStatus[]; summary: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchIntegrations()
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-white/50">
        <Loader2 className="h-3 w-3 animate-spin" /> Reading integration status…
      </div>
    );
  }
  if (error) {
    return (
      <p className="flex items-center gap-2 text-xs text-red-400">
        <AlertCircle className="h-3.5 w-3.5" /> {error}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className={`rounded-xl p-4 text-sm ${CARD}`}>
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4" />
          <span className="font-medium">Configuration status</span>
        </div>
        <p className="mt-1 text-xs text-white/60">{data?.summary}</p>
        <p className="mt-2 text-[11px] text-white/40">
          Values are never shown. Presence of a credential is not verified capability — any
          unverified entry is marked explicitly below.
        </p>
      </div>

      <div className="space-y-3">
        {(data?.integrations ?? []).map((i) => (
          <Card key={i.provider} className={CARD}>
            <CardContent className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{i.provider}</span>
                <span className="text-xs text-white/50">{i.purpose}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {i.configured ? (
                  <Badge className="bg-emerald-500/20 text-emerald-300">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> configured
                  </Badge>
                ) : (
                  <Badge className="bg-amber-500/20 text-amber-300"><AlertCircle className="mr-1 h-3 w-3" /> not configured</Badge>
                )}
                {i.verified && (
                  <Badge variant="outline" className="border-white/20 text-[10px] text-white/70">
                    verified: {i.verified}
                  </Badge>
                )}
                {i.unverified && (
                  <Badge variant="outline" className="border-amber-500/30 text-[10px] text-amber-300">
                    <ShieldQuestion className="mr-1 h-3 w-3" /> {i.unverified}
                  </Badge>
                )}
              </div>
              {i.missing && <p className="text-xs text-amber-300/80">{i.missing}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
