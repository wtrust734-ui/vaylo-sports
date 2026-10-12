// ============================================================================
// GOOGLE GEMINI — the shared adapter for FORM ANALYSIS
// ----------------------------------------------------------------------------
// The product decision is that every form-analysis feature runs on the Google
// API (photo analysis in ai-analyze, video analysis in video-form-analysis),
// and every other AI feature runs on OpenAI. This module is the ONE place that
// speaks Gemini's Generative Language API, mirroring _shared/openai.ts for the
// other provider: one URL shape, one secret (GOOGLE_API), one place that can
// ever leak a provider body into a log.
//
// Log hygiene, deliberately: failures return { ok: false, status } and log the
// HTTP status plus a fixed marker. The raw provider body is never read on the
// error path — it can echo request metadata back into our logs — and client
// facing messages are chosen by the caller, never passed through.
// ============================================================================

/**
 * A Gemini content part: text, an inline (data-URL payload) image, or a file
 * that was uploaded first.
 *
 * The `fileData` variant exists for video. A clip of any useful length is far
 * too big to inline inside a JSON request — inline data has to fit the request
 * itself, which is what capped video analysis at six megabytes of base64 — so a
 * clip is uploaded once through the Files API and then referenced by URI. Same
 * model, same call, one extra upload step (see geminiUploadFile below).
 */
export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { fileUri: string; mimeType: string } };

export interface GeminiCall {
  /** Model id — always from GEMINI_MODELS in aiModels.ts, never a literal. */
  model: string;
  apiKey: string;
  /** System instruction. Optional: some prompts are fully inlined by design. */
  systemText?: string;
  /** User content parts, in order (text prompt first, then images). */
  parts: GeminiPart[];
  /** Optional generation config (responseMimeType / responseSchema, etc.). */
  generationConfig?: Record<string, unknown>;
}

export type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; status: number };

/**
 * One generateContent call. Resolves with the concatenated candidate text on
 * success, or the HTTP status on failure — never the response body.
 */
export async function geminiGenerate(call: GeminiCall): Promise<GeminiResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${call.model}:generateContent?key=${call.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: call.parts }],
        ...(call.systemText
          ? { systemInstruction: { parts: [{ text: call.systemText }] } }
          : {}),
        ...(call.generationConfig ? { generationConfig: call.generationConfig } : {}),
      }),
    },
  );

  if (!res.ok) {
    // Status + marker only — never the raw provider body.
    console.error("Gemini request failed", res.status, "upstream_error");
    return { ok: false, status: res.status };
  }

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  return { ok: true, text: parts.map((p) => p.text ?? "").join("") };
}

/* ------------------------------------------------------- Files API (video) */

const FILES_URL = "https://generativelanguage.googleapis.com/v1beta/files";
const UPLOAD_URL = "https://generativelanguage.googleapis.com/upload/v1beta/files";
/** How long to wait for Gemini to finish ingesting a clip before giving up. */
const FILE_READY_TIMEOUT_MS = 30_000;
const FILE_READY_POLL_MS = 750;

/** A clip uploaded to the Files API, ready to be referenced by a call. */
export interface GeminiUploadedFile {
  /** Resource name ("files/abc-123") — what files.delete takes. */
  name: string;
  /** The URI a `fileData` part points at. */
  uri: string;
}

export interface GeminiUpload {
  apiKey: string;
  bytes: Uint8Array;
  mimeType: string;
  /** Human-readable label shown in the provider's dashboard. Never a user id. */
  displayName: string;
}

export type GeminiUploadResult =
  | { ok: true; file: GeminiUploadedFile }
  | { ok: false; status: number };

/**
 * Upload media bytes to the Gemini Files API and wait until the file is ACTIVE.
 *
 * The Files API is a two-request resumable upload: the first call declares the
 * size and type and answers with an upload URL in a header, the second sends
 * the bytes and finalizes. The file then processes asynchronously — a video is
 * not usable until its state is ACTIVE — so this polls until it is, bounded, and
 * reports a failure rather than handing the caller a URI that would 400 later.
 *
 * Same log hygiene as geminiGenerate: status and a fixed marker, never the
 * provider's body.
 */
export async function geminiUploadFile(upload: GeminiUpload): Promise<GeminiUploadResult> {
  const start = await fetch(`${UPLOAD_URL}?key=${upload.apiKey}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(upload.bytes.byteLength),
      "X-Goog-Upload-Header-Content-Type": upload.mimeType,
    },
    body: JSON.stringify({ file: { displayName: upload.displayName } }),
  });
  if (!start.ok) {
    console.error("Gemini upload start failed", start.status, "upstream_error");
    return { ok: false, status: start.status };
  }

  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) {
    // A 200 with no upload URL is not something the caller can act on, so it is
    // a failure here rather than a retry behind the athlete's back.
    console.error("Gemini upload url missing", "upstream_error");
    return { ok: false, status: 502 };
  }

  // Content-Length is deliberately left to fetch: it is derived from the body,
  // and a manual value that disagrees with it would truncate the clip.
  //
  // The bytes are re-wrapped in a Blob before they are sent. Not a copy we want,
  // but the honest one: `storage.download()` hands back
  // `Uint8Array<ArrayBufferLike>`, which the DOM lib refuses as a `BodyInit`
  // because the buffer *could* be a SharedArrayBuffer. `new Uint8Array(existing)`
  // yields the plain `Uint8Array<ArrayBuffer>` the type system wants, so the
  // types and the runtime agree without a cast that would hide a real mismatch.
  const body = new Blob([new Uint8Array(upload.bytes)], { type: upload.mimeType });
  const finish = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Type": upload.mimeType,
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
    },
    body,
  });
  if (!finish.ok) {
    console.error("Gemini upload failed", finish.status, "upstream_error");
    return { ok: false, status: finish.status };
  }

  const created = (await finish.json().catch(() => null)) as {
    file?: { name?: string; uri?: string; state?: string };
  } | null;
  let name = created?.file?.name ?? "";
  let uri = created?.file?.uri ?? "";
  let state = created?.file?.state ?? "";
  if (!name || !uri) {
    console.error("Gemini upload response incomplete", "upstream_error");
    return { ok: false, status: 502 };
  }

  const deadline = Date.now() + FILE_READY_TIMEOUT_MS;
  while (state === "PROCESSING" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, FILE_READY_POLL_MS));
    const poll = await fetch(`${FILES_URL}/${name}?key=${upload.apiKey}`);
    if (!poll.ok) {
      console.error("Gemini file poll failed", poll.status, "upstream_error");
      return { ok: false, status: poll.status };
    }
    const info = (await poll.json().catch(() => null)) as {
      name?: string;
      uri?: string;
      state?: string;
    } | null;
    name = info?.name ?? name;
    uri = info?.uri ?? uri;
    state = info?.state ?? state;
  }

  if (state !== "ACTIVE") {
    // FAILED, or still processing when the deadline passed. Either way the
    // caller must not send this URI to generateContent.
    console.error("Gemini file not usable", state || "unknown_state", "upstream_error");
    return { ok: false, status: 502 };
  }
  return { ok: true, file: { name, uri } };
}

/**
 * Delete an uploaded file. Best effort by design: the caller deletes inside a
 * cleanup path, and a failure here must never turn a delivered analysis into an
 * error. Uploaded files also expire on their own (48 hours), so an orphan is
 * temporary rather than permanent.
 */
export async function geminiDeleteFile(args: { apiKey: string; name: string }): Promise<void> {
  try {
    const res = await fetch(`${FILES_URL}/${args.name}?key=${args.apiKey}`, { method: "DELETE" });
    if (!res.ok) console.error("Gemini file delete failed", res.status, "upstream_error");
  } catch {
    console.error("Gemini file delete failed", "transport_error");
  }
}
