import { useCallback, useEffect, useState } from "react";
import {
  FlaskConical,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  ExternalLink,
  Search,
  AlertTriangle,
  ClipboardPaste,
  Download,
  Sparkles,
  Table2,
  Megaphone,
  Globe,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  listCompetitors,
  addCompetitor,
  updateCompetitor,
  deleteCompetitor,
  startResearch,
  researchStatus,
  researchResults,
  ingestFinding,
  analyzeFinding,
  generateOpportunities,
  compareCompetitors,
  exportResearch,
  listResearchProjects,
  type Competitor,
  type Finding,
  type ResearchResults,
  type Comparison,
} from "./researchApi";

const CARD = "bg-white/5 border border-white/10";
const ACCENT = "bg-[#8505D5] text-white";

/* ------------------------------------------------------------------ helpers */

const SOURCE_LABEL: Record<string, string> = {
  meta_library: "Meta Ad Library · advertising record",
  tiktok_library: "TikTok Commercial Content · advertising record",
  google_transparency: "Google Transparency · advertising record",
  official_page: "Official page · ordinary content",
  press: "Press page · ordinary content",
  social: "Official social · ordinary content",
  manual: "Manually captured evidence",
};

const KIND_BADGE: Record<string, string> = {
  ad: "bg-purple-500/20 text-purple-200",
  organic: "bg-white/10 text-white/70",
  page: "bg-blue-500/20 text-blue-300",
};

type Tab = "results" | "compare" | "opportunities";

export default function ResearchView({ onOpenChat }: { onOpenChat?: () => void } = {}) {
  // ---------------------------------------------------------------- competitors
  const [competitors, setCompetitors] = useState<Competitor[] | null>(null);
  const [editingComp, setEditingComp] = useState<{ id?: string; name: string; website: string; notes: string } | null>(null);

  // ---------------------------------------------------------------- scope + run
  const [selected, setSelected] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---------------------------------------------------------------- results
  const [results, setResults] = useState<ResearchResults | null>(null);
  const [tab, setTab] = useState<Tab>("results");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [oppsBusy, setOppsBusy] = useState(false);
  const [exported, setExported] = useState<string | null>(null);

  // ---------------------------------------------------------------- ingest + analyse
  const [ingesting, setIngesting] = useState<{ url: string; title: string; excerpt: string; kind: "ad" | "organic" | "page"; publishedAt: string } | null>(null);
  const [analysing, setAnalysing] = useState<string | null>(null);
  const [showingAnalysis, setShowingAnalysis] = useState<Finding | null>(null);

  const loadCompetitors = useCallback(() => {
    listCompetitors().then(setCompetitors).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(loadCompetitors, [loadCompetitors]);

  useEffect(() => {
    listResearchProjects().catch(() => undefined);
  }, []);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const run = async () => {
    if (running || !selected.length) return;
    setRunning(true);
    setError(null);
    setProgress("Validating scope and planning sources…");
    try {
      const names = selected
        .map((id) => competitors?.find((c) => c.id === id)?.name)
        .filter((n): n is string => Boolean(n));
      const start = await startResearch({ competitors: names, topic: topic.trim(), title: topic.trim() ? `Research: ${topic.trim()}` : undefined });
      setProgress(`Retrieval run finished (${start.findings} finding(s), ${start.blockedCount} blocked source(s)). Reading results…`);
      const payload = await researchResults(start.projectId);
      setResults(payload);
      setTab("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not run the research.");
      setProgress(null);
    } finally {
      setRunning(false);
    }
  };

  const loadComparison = async () => {
    if (!results || comparison) return setTab("compare");
    try {
      const cmp = await compareCompetitors(results.project.id);
      setComparison(cmp);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the comparison.");
    }
    setTab("compare");
  };

  const genOpps = async () => {
    if (!results || oppsBusy) return;
    setOppsBusy(true);
    setError(null);
    try {
      await generateOpportunities(results.project.id);
      setResults(await researchResults(results.project.id));
      setTab("opportunities");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate opportunities.");
    } finally {
      setOppsBusy(false);
    }
  };

  const downloadExport = async () => {
    if (!results) return;
    try {
      const md = await exportResearch(results.project.id);
      setExported(md);
      const blob = new Blob([md], { type: "text/markdown" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${results.project.title.replace(/[^\w -]+/g, "").slice(0, 60) || "research"}.md`;
      a.click();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    }
  };

  const doIngest = async () => {
    if (!results || !ingesting) return;
    try {
      await ingestFinding({
        projectId: results.project.id,
        sourceUrl: ingesting.url,
        title: ingesting.title,
        excerpt: ingesting.excerpt,
        kind: ingesting.kind,
        publishedAt: ingesting.publishedAt || undefined,
      });
      setIngesting(null);
      setResults(await researchResults(results.project.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the captured evidence.");
    }
  };

  const doAnalyze = async (f: Finding) => {
    setAnalysing(f.id);
    setError(null);
    try {
      const { analysis, mode } = await analyzeFinding(f.id);
      setResults((r) =>
        r
          ? {
              ...r,
              findings: r.findings.map((x) => (x.id === f.id ? { ...x, analysis: { mode, analysis } } : x)),
            }
          : r,
      );
      setShowingAnalysis({ ...f, analysis: { mode, analysis } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setAnalysing(null);
    }
  };

  const saveCompetitor = async () => {
    if (!editingComp) return;
    try {
      if (editingComp.id) await updateCompetitor(editingComp.id, editingComp.name, editingComp.website || null, editingComp.notes);
      else await addCompetitor(editingComp.name, editingComp.website || null);
      setEditingComp(null);
      loadCompetitors();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the competitor.");
    }
  };

  /* ------------------------------------------------------------------ render */

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-10">
      {/* ---- competitor roster ---- */}
      <Card className={CARD}>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <Globe className="h-4 w-4" /> Competitor roster
              {competitors === null && <Loader2 className="h-3 w-3 animate-spin" />}
            </h3>
            <div className="flex gap-2">
              <button onClick={() => setEditingComp({ name: "", website: "", notes: "" })} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/20">
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
              {selected.length > 0 && (
                <button
                  onClick={run}
                  disabled={running}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs ${ACCENT} disabled:opacity-40`}
                >
                  {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />} Run research ({selected.length})
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(competitors ?? []).map((c) => (
              <div key={c.id} className={`flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs ${selected.includes(c.id) ? "border-transparent bg-[#8505D5]/30" : "bg-white/5 text-white/70"}`}>
                {c.id.startsWith("seed-") ? (
                  <input type="checkbox" className="hidden" />
                ) : (
                  <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} className="accent-[#8505D5]" />
                )}
                <span>{c.name}</span>
                <span className="text-white/30">·</span>
                <a href={c.website ?? "#"} target="_blank" rel="noreferrer" className="text-white/40 hover:text-white/70" aria-label={`${c.name} website`}>
                  <ExternalLink className="inline h-3 w-3" />
                </a>
                {c.id.startsWith("seed-") ? (
                  <span className="text-[9px] text-amber-300">pending setup</span>
                ) : (
                  <>
                    <button onClick={() => setEditingComp({ id: c.id, name: c.name, website: c.website ?? "", notes: c.notes ?? "" })} className="text-white/40 hover:text-white">
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      onClick={async () => {
                        if (!window.confirm(`Remove ${c.name} from the roster?`)) return;
                        await deleteCompetitor(c.id).catch((e: Error) => setError(e.message));
                        loadCompetitors();
                      }}
                      className="text-red-300/70 hover:text-red-300"
                      aria-label={`Remove ${c.name}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          <Input className="bg-black/40" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic/scope — e.g. how personalised coaching is advertised" />

          {progress && (
            <div className="flex items-center gap-2 text-xs text-white/60">
              <Loader2 className="h-3 w-3 animate-spin" /> {progress}
            </div>
          )}
          {error && (
            <p className="flex items-center gap-2 text-xs text-red-400">
              <AlertTriangle className="h-3.5 w-3.5" /> {error}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---- results ---- */}
      {results && (
        <>
          <Card className={CARD}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">{results.project.title}</h3>
                  <p className="text-xs text-white/50">
                    Status: {results.project.status} · {results.findings.length} finding(s) · topic: {results.project.topic || "—"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(["results", "compare", "opportunities"] as Tab[]).map((t) => (
                    <button
                      key={t}
                      onClick={t === "compare" ? loadComparison : () => setTab(t)}
                      className={`rounded-lg px-2.5 py-1.5 text-xs ${tab === t ? ACCENT : "bg-white/10 text-white/70"}`}
                    >
                      {t === "results" ? "Findings" : t === "compare" ? (<><Table2 className="mr-1 inline h-3 w-3" />Compare</>) : (<><Sparkles className="mr-1 inline h-3 w-3" />Opportunities</>)}
                    </button>
                  ))}
                  <button onClick={downloadExport} className="rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-white/70">
                    <Download className="mr-1 inline h-3 w-3" /> Export
                  </button>
                </div>
              </div>

              {results.project.log?.length > 0 && (
                <div className="mt-2 rounded-lg bg-black/30 p-2 text-[11px] text-white/50">
                  {results.project.log.slice(-6).map((l, i) => (
                    <div key={i}>{l}</div>
                  ))}
                </div>
              )}

              {results.blocked.length > 0 && (
                <div className="mt-2 space-y-1 rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-300">
                  {results.blocked.map((b, i) => (
                    <p key={i}>⚠ {b.reason}</p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {tab === "results" && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button onClick={() => setIngesting({ url: "", title: "", excerpt: "", kind: "ad", publishedAt: "" })} className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-xs text-white/80 hover:bg-white/20">
                  <ClipboardPaste className="h-3.5 w-3.5" /> Add captured evidence manually
                </button>
              </div>

              {results.blocked.length > 0 && results.findings.filter((f) => f.source_type.endsWith("library")).length === 0 && (
                <p className="rounded-lg bg-amber-500/10 p-2 text-[11px] text-amber-300">
                  No advertising-library records yet — until the owner's Meta/TikTok applications are approved, captured evidence comes through manual ingest; automatic retrieval covers official and press pages only.
                </p>
              )}

              {results.findings.map((f) => (
                <div key={f.id} className={`rounded-xl p-4 ${CARD}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${KIND_BADGE[f.kind]}`}>{f.kind === "ad" ? (<><Megaphone className="mr-1 inline h-3 w-3" />advertising</>) : "ordinary content"}</span>
                    <Badge variant="outline" className="border-white/20 text-[10px] text-white/70">{SOURCE_LABEL[f.source_type] ?? f.source_type}</Badge>
                    {f.competitor_name && <span className="text-xs text-white/60">{f.competitor_name}</span>}
                  </div>
                  <div className="mt-1 truncate text-sm font-medium">{f.title || f.source_url}</div>
                  {f.excerpt && <p className="mt-1 line-clamp-2 text-xs text-white/60">{f.excerpt}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-white/40">
                    <a href={f.source_url} target="_blank" rel="noreferrer" className="text-white/50 hover:text-white/80">
                      <ExternalLink className="mr-1 inline h-3 w-3" /> source
                    </a>
                    <span>retrieved {new Date(f.retrieved_at).toLocaleString()}</span>
                    {f.published_at && <span>published {new Date(f.published_at).toLocaleDateString()}</span>}
                    {f.media_kind !== "none" && f.media_kind !== "unknown" && <span>media: {f.media_kind} {f.media_kind === "unknown" ? "(not analysed)" : ""}</span>}
                    <button
                      onClick={() => void doAnalyze(f)}
                      disabled={analysing === f.id}
                      className="ml-auto rounded bg-white/10 px-2 py-1 text-[11px] text-white/80 hover:bg-white/20 disabled:opacity-40"
                    >
                      {analysing === f.id ? <Loader2 className="mr-1 inline h-3 w-3 animate-spin" /> : <Search className="mr-1 inline h-3 w-3" />}
                      {f.analysis ? "Re-analyse" : "Analyse"}
                    </button>
                    {f.analysis && (
                      <button onClick={() => setShowingAnalysis(f)} className="rounded bg-white/10 px-2 py-1 text-[11px] text-white/80">
                        View analysis ({f.analysis.mode})
                      </button>
                    )}
                  </div>
                  {Object.keys(f.captured ?? {}).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {Object.entries(f.captured).map(([k, v], i) => (
                        <span key={i} className="rounded bg-white/10 px-2 py-0.5 text-[10px] text-white/60">
                          {k}: {v}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === "compare" && comparison && (
            <Card className={CARD}>
              <CardContent className="overflow-x-auto p-4">
                <div className="mb-2 text-xs text-white/50">
                  Only attributes with evidence appear; blank cells mean no evidence was captured — never absence of activity. Coverage:
                  {comparison.coverage.map((c) => ` ${c.competitor}: ${c.evidenceCount}`).join(" ·")}
                </div>
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-white/70">
                      <th className="p-2">Dimension</th>
                      {comparison.rows[0]?.rows.map((r) => (<th key={r.competitor} className="p-2">{r.competitor}</th>))}
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.rows.map((d) => (
                      <tr key={d.dimension} className="border-t border-white/10">
                        <td className="p-2 text-white/60">{d.dimension}</td>
                        {d.rows.map((r) => (
                          <td key={r.competitor} className="p-2">
                            {r.value ? `${r.value} (${r.evidenceCount} evidence)` : <span className="text-white/30 italic">no supporting evidence</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {tab === "opportunities" && (
            <div className="space-y-3">
              <button onClick={genOpps} disabled={oppsBusy} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${ACCENT} disabled:opacity-40`}>
                {oppsBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Generate opportunities from stored evidence
              </button>
              {results.findings.length === 0 && <p className="text-xs text-white/50">No findings yet — run retrieval or add manual evidence first.</p>}
              {results.opportunities.map((o, i) => {
                const opt = o as Record<string, string>;
                return (
                  <Card key={i} className={CARD}>
                    <CardContent className="space-y-1.5 p-4 text-xs">
                      <h4 className="text-sm font-semibold">{opt.approach}</h4>
                      <p><span className="text-white/50">Observation:</span> {opt.observation}</p>
                      <p><span className="text-white/50">Evidence:</span> finding refs {opt.evidenceFindingIds}</p>
                      <p><span className="text-white/50">Interpretation:</span> {opt.interpretation}</p>
                      <p><span className="text-white/50">Gap:</span> {opt.gap}</p>
                      <p><span className="text-white/50">Format:</span> {opt.suggestedFormat} · <span className="text-white/50">Audience:</span> {opt.targetAudience}</p>
                      <p><span className="text-white/50">Hook:</span> “{opt.hook}” · <span className="text-white/50">CTA:</span> {opt.cta}</p>
                      <p><span className="text-white/50">Validation:</span> {opt.validationPlan}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {!results && !running && (
        <div className={`rounded-xl p-8 text-center text-sm text-white/60 ${CARD}`}>
          Select competitors and run research. Retrieval covers official and press pages automatically; captured ad-library
          evidence goes through manual ingest until the owner's platform approvals exist.
        </div>
      )}

      {/* ---- competitor edit dialog ---- */}
      <Dialog open={editingComp !== null} onOpenChange={(o) => !o && setEditingComp(null)}>
        <DialogContent className="w-[min(92vw,420px)] border-white/15 bg-[#0d1017] text-white">
          <DialogHeader>
            <DialogTitle>{editingComp?.id ? "Edit competitor" : "Add competitor"}</DialogTitle>
            <DialogDescription className="text-white/50">
              The website is https-only and is the base for retrieval candidates (landing/press/news).
            </DialogDescription>
          </DialogHeader>
          {editingComp && (
            <div className="space-y-3 text-sm">
              <Input className="bg-black/40" placeholder="Name" value={editingComp.name} onChange={(e) => setEditingComp({ ...editingComp, name: e.target.value })} />
              <Input className="bg-black/40" placeholder="https://website (optional)" value={editingComp.website} onChange={(e) => setEditingComp({ ...editingComp, website: e.target.value })} />
              <Input className="bg-black/40" placeholder="Notes (optional)" value={editingComp.notes} onChange={(e) => setEditingComp({ ...editingComp, notes: e.target.value })} />
              <div className="flex justify-end gap-2">
                <button className="rounded-lg bg-white/10 px-3 py-2" onClick={() => setEditingComp(null)}>Cancel</button>
                <button className={`rounded-lg px-3 py-2 ${ACCENT} disabled:opacity-40`} disabled={!editingComp.name.trim()} onClick={saveCompetitor}>Save</button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ---- manual ingest dialog ---- */}
      <Dialog open={ingesting !== null} onOpenChange={(o) => !o && setIngesting(null)}>
        <DialogContent className="w-[min(92vw,480px)] border-white/15 bg-[#0d1017] text-white">
          <DialogHeader>
            <DialogTitle>Add captured evidence</DialogTitle>
            <DialogDescription className="text-white/50">
              For advertising-library records you lawfully viewed (paste the library URL you captured it from) or organic posts. Verbatim copy only.
            </DialogDescription>
          </DialogHeader>
          {ingesting && (
            <div className="space-y-3 text-sm">
              <Input className="bg-black/40" placeholder="Source URL (library/ad page or post)" value={ingesting.url} onChange={(e) => setIngesting({ ...ingesting, url: e.target.value })} />
              <Input className="bg-black/40" placeholder="Title" value={ingesting.title} onChange={(e) => setIngesting({ ...ingesting, title: e.target.value })} />
              <select className="w-full rounded-lg bg-black/40 px-3 py-2 text-sm" value={ingesting.kind} onChange={(e) => setIngesting({ ...ingesting, kind: e.target.value as "ad" | "organic" | "page" })}>
                <option value="ad">advertising-library record (paid/labelled ad)</option>
                <option value="organic">brand organic post</option>
                <option value="page">official page</option>
              </select>
              <textarea className="min-h-[90px] w-full rounded-lg bg-black/40 px-3 py-2 text-xs" placeholder="Verbatim captured copy: hook, message, CTA…" value={ingesting.excerpt} onChange={(e) => setIngesting({ ...ingesting, excerpt: e.target.value })} />
              <Input className="bg-black/40" type="date" value={ingesting.publishedAt} onChange={(e) => setIngesting({ ...ingesting, publishedAt: e.target.value })} />
              <div className="flex justify-end gap-2">
                <button className="rounded-lg bg-white/10 px-3 py-2" onClick={() => setIngesting(null)}>Cancel</button>
                <button className={`rounded-lg px-3 py-2 ${ACCENT} disabled:opacity-40`} disabled={!ingesting.url.trim()} onClick={doIngest}>Save evidence</button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ---- analysis dialog ---- */}
      <Dialog open={showingAnalysis !== null} onOpenChange={(o) => !o && setShowingAnalysis(null)}>
        <DialogContent className="max-h-[85vh] w-[min(94vw,560px)] overflow-y-auto border-white/15 bg-[#0d1017] text-white">
          <DialogHeader>
            <DialogTitle className="truncate">{showingAnalysis?.title}</DialogTitle>
            <DialogDescription className="text-[11px] text-amber-300/80">
              Mode: {showingAnalysis?.analysis?.mode === "text" ? "text-only — the creative media itself was not inspected" : showingAnalysis?.analysis?.mode}
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const a = showingAnalysis?.analysis?.analysis as unknown as Record<string, unknown> | undefined;
            const captured = (a?.captured ?? {}) as Record<string, string>;
            const quotes = (a?.quotes ?? []) as string[];
            return a ? (
              <div className="space-y-3 text-xs">
                <div className="space-y-1">
                  {Object.entries(captured).map(([k, v], i) => (
                    <p key={i}><span className="text-white/50">{k}:</span> {v}</p>
                  ))}
                </div>
                {quotes.length > 0 && (
                  <div className="rounded-lg bg-black/30 p-2">
                    <p className="mb-1 text-white/50">Verbatim basis:</p>
                    <ul className="list-disc space-y-1 pl-4 text-white/70">
                      {quotes.map((q, i) => (<li key={i}>“{q}”</li>))}
                    </ul>
                  </div>
                )}
                {String(a.interpretation ?? "") && (
                  <p className="rounded-lg bg-purple-500/10 p-2">
                    <span className="font-medium text-purple-200">Interpretation (ours): </span>
                    {String(a.interpretation)}
                  </p>
                )}
                {((a.unavailable ?? []) as string[]).length > 0 && (
                  <div className="rounded-lg bg-white/5 p-2">
                    <p className="text-white/50">Not establishable from this text:</p>
                    <ul className="list-disc pl-4 text-white/50">
                      {((a.unavailable ?? []) as string[]).map((u, i) => (<li key={i}>{u}</li>))}
                    </ul>
                  </div>
                )}
              </div>
            ) : null;
          })()}
        </DialogContent>
      </Dialog>

      {/* ---- export preview ---- */}
      <Dialog open={exported !== null} onOpenChange={(o) => !o && setExported(null)}>
        <DialogContent className="max-h-[85vh] w-[min(94vw,640px)] overflow-y-auto border-white/15 bg-[#0d1017] text-white">
          <DialogHeader><DialogTitle>Research report (markdown)</DialogTitle></DialogHeader>
          <pre className="whitespace-pre-wrap text-[11px] text-white/70">{exported}</pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
