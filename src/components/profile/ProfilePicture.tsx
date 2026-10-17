import { useState, useRef } from "react";
import { Image, Loader2, Camera, Upload, X } from "lucide-react";
import { uploadProfilePicture, type ProfilePictureResult } from "@/lib/profile-upload";
import { cn } from "@/lib/utils";

interface ProfilePictureProps {
  /** Existing public URL, if one is uploaded. */
  src?: string | null;
  /** Called with the new public URL once an upload succeeds. */
  onUploaded?: (url: string) => void;
  className?: string;
}

const PROFILE_PICTURE_LIMIT_MB = 5;

export default function ProfilePicture({ src, onUploaded, className }: ProfilePictureProps) {
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const startPick = () => {
    setPicking(true);
    setError(null);
    setPreview(null);
  };

  const abort = () => {
    setPicking(false);
    setUploading(false);
    setProgress(0);
    setError(null);
    setPreview(null);
    inputRef.current?.value && (inputRef.current.value = "");
  };

  const handleFile = async (file: File | null) => {
    if (!file) {
      setPicking(false);
      return;
    }
    if (file.size > PROFILE_PICTURE_LIMIT_MB * 1024 * 1024) {
      setError(`Picture must be under ${PROFILE_PICTURE_LIMIT_MB} MB`);
      setPicking(false);
      inputRef.current?.value && (inputRef.current.value = "");
      return;
    }
    setPicking(false);
    setUploading(true);
    setProgress(0);
    setError(null);

    const result = await uploadProfilePicture(file, setProgress);

    setUploading(false);
    if (result.ok) {
      setPreview(result.url);
      onUploaded?.(result.url);
      setTimeout(() => setPreview(null), 1800);
    } else if (isFailure(result)) {
      // A typed guard rather than a bare `else if (!result.ok)`: this project's
      // tsconfig combination does not narrow the union through `!ok`, so a
      // predicate guarantees the false-arm (whose `reason` key exists).
      setError(cameraUploadErrorMessage(result.reason));
      setProgress(0);
      inputRef.current?.value && (inputRef.current.value = "");
    }
  };

  const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    void handleFile(file);
  };

  return (
    <div className={cn("relative", className)}>
      {/* Current photo or placeholder. */}
      <div className="pointer-events-auto overflow-hidden rounded-full bg-secondary border border-border ring-1 ring-white/10">
        {src ? (
          <img src={src} alt="Profile picture" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center text-muted-foreground">
            <Camera size={24} />
          </div>
        )}
      </div>

      {/* Upload overlay when picking. */}
      {picking && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-white">
            <Upload size={20} />
            <p className="text-sm font-semibold">Change photo</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                Choose from library
              </button>
              <button
                type="button"
                onClick={abort}
                className="rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progress + error banner, above the ring. */}
      {uploading && (
        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-card/90 border border-border px-3 py-1.5 text-xs font-semibold text-foreground">
          <Loader2 size={12} className="inline-block animate-spin mr-1" />
          Uploading {progress}%
        </div>
      )}

      {error && (
        <div className="mt-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
          <button
            type="button"
            onClick={abort}
            className="float-right -mt-1 -mr-1 rounded-full p-1 text-muted-foreground hover:text-foreground"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Hidden file input. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        capture={undefined}
        className="hidden"
        onChange={onInput}
        disabled={uploading}
      />

      {preview && (
        <div className="mt-2 flex items-center gap-2 text-sm text-primary font-semibold">
          <Image size={14} /> Photo saved
        </div>
      )}
    </div>
  );
}

type ProfilePictureReason = Extract<ProfilePictureResult, { ok: false }>["reason"];

type ProfilePictureFailure = Extract<ProfilePictureResult, { ok: false }>;

function isFailure(result: ProfilePictureResult): result is ProfilePictureFailure {
  return result.ok === false;
}

function cameraUploadErrorMessage(reason: ProfilePictureReason): string {
  switch (reason) {
    case "no-file":
      return "No photo was selected.";
    case "not-configured":
      return "Profile pictures aren't set up on this project yet.";
    case "not-signed-in":
      return "Sign in to set a profile picture.";
    case "upload-failed":
      return "Couldn't upload that photo. Check your connection and try again.";
  }
}
