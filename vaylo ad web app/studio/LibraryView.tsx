import { useEffect, useRef, useState } from "react";
import {
  Upload,
  Loader2,
  Trash2,
  Download,
  Search,
  AlertCircle,
  Image as ImageIcon,
  Video,
  FileText,
  Music,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  listLibrary,
  uploadLibraryItem,
  deleteLibraryItem,
  librarySignedUrl,
  type LibraryItem,
  type LibraryKind,
} from "./api";

const CARD = "bg-white/5 border border-white/10";
const KINDS: LibraryKind[] = ["image", "video", "audio", "script", "storyboard", "document"];

const kindIcon = (k: LibraryKind) => {
  if (k === "image") return <ImageIcon className="h-4 w-4" />;
  if (k === "video") return <Video className="h-4 w-4" />;
  if (k === "audio") return <Music className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
};

export default function LibraryView() {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [kind, setKind] = useState<LibraryKind | "">("");
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ item: LibraryItem; url: string } | null>(null);
  const [deleting, setDeleting] = useState<LibraryItem | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = () =>
    listLibrary({ kind: kind || undefined, search: search.trim() || undefined })
      .then((i) => {
        setItems(i);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    const t = setTimeout(load, search || kind ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, search]);

  const upload = async (file: File | undefined) => {
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    try {
      await uploadLibraryItem(file, deriveKind(file), null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const openPreview = async (item: LibraryItem) => {
    if (item.kind !== "image" && item.kind !== "video" && item.kind !== "audio" && item.kind !== "document") return;
    try {
      const url = await librarySignedUrl(item.storage_path);
      setPreview({ item, url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open that asset.");
    }
  };

  const download = async (item: LibraryItem) => {
    try {
      const url = await librarySignedUrl(item.storage_path);
      const a = document.createElement("a");
      a.href = url;
      a.download = item.name;
      a.click();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed.");
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteLibraryItem(deleting);
      setDeleting(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-white/40" />
          <Input className="bg-black/40 pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assets…" />
        </div>
        <select className="rounded-lg bg-black/40 px-3 py-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value as LibraryKind | "")}>
          <option value="">All kinds</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <button onClick={() => fileRef.current?.click()} disabled={uploading} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm ${"bg-[#8505D5] text-white"} disabled:opacity-40`}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept="image/*,video/*,audio/*,application/pdf,text/plain"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
      </div>

      {error && (
        <p className="flex items-center gap-2 text-xs text-red-400">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      )}

      {items === null && (
        <div className="flex items-center gap-2 text-xs text-white/50">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading library…
        </div>
      )}

      {items !== null && items.length === 0 && (
        <div className={`rounded-xl p-8 text-center text-sm text-white/60 ${CARD}`}>
          Nothing stored yet — upload source material or let the generate workflows add finished assets here.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(items ?? []).map((it) => (
          <div key={it.id} className={`flex items-start gap-3 rounded-xl p-4 ${CARD}`}>
            <div className="mt-0.5 rounded-lg bg-white/10 p-2 text-white/70">{kindIcon(it.kind)}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{it.name}</span>
                <Badge variant="outline" className="shrink-0 border-white/20 text-[10px] text-white/70">
                  {it.status}
                </Badge>
              </div>
              <p className="text-xs text-white/50">
                {it.kind}
                {it.mime ? ` · ${it.mime}` : ""}
                {it.size_bytes ? ` · ${(it.size_bytes / 1024).toFixed(0)} KB` : ""} · {new Date(it.created_at).toLocaleDateString()}
              </p>
              <div className="mt-2 flex gap-1.5">
                {(it.kind === "image" || it.kind === "video" || it.kind === "audio" || it.kind === "document") && (
                  <button onClick={() => void openPreview(it)} className="rounded bg-white/10 px-2 py-1 text-[11px] text-white/80 hover:bg-white/20">
                    Preview
                  </button>
                )}
                <button onClick={() => void download(it)} className="rounded bg-white/10 px-2 py-1 text-[11px] text-white/80 hover:bg-white/20">
                  <Download className="mr-1 inline h-3 w-3" /> Download
                </button>
                <button onClick={() => setDeleting(it)} className="rounded bg-red-500/20 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/30">
                  <Trash2 className="mr-1 inline h-3 w-3" /> Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Preview */}
      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="w-[min(94vw,720px)] border-white/15 bg-[#0d1017] text-white">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.item.name}</DialogTitle>
          </DialogHeader>
          {preview?.item.kind === "image" && <img src={preview.url} alt={preview.item.name} className="max-h-[70vh] w-full rounded-lg object-contain" />}
          {preview?.item.kind === "video" && <video src={preview.url} controls className="max-h-[70vh] w-full rounded-lg" />}
          {preview?.item.kind === "audio" && <audio src={preview.url} controls className="w-full" />}
          {preview?.item.kind === "document" && (
            <a href={preview.url} target="_blank" rel="noreferrer" className="text-sm underline">
              Open document in a new tab
            </a>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="w-[min(92vw,400px)] border-white/15 bg-[#0d1017] text-white">
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-white/50">The stored file and its metadata record are removed permanently.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setDeleting(null)} className="rounded-lg bg-white/10 px-3 py-2 text-sm">
              Cancel
            </button>
            <button onClick={confirmDelete} className="rounded-lg bg-red-500 px-3 py-2 text-sm text-white">
              Delete
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function deriveKind(file: File): LibraryKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "document";
}
