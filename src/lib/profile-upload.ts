// eslint-disable-next-line @typescript-eslint/no-require-imports

export type ProfilePictureResult =
  | { ok: true; url: string }
  | { ok: false; reason: "no-file" | "not-configured" | "upload-failed" | "not-signed-in" };

type StorageResult = { data: unknown; error: unknown };

function asStorageResult(value: unknown): StorageResult | null {
  if (value == null || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.data !== "undefined" && typeof candidate.error !== "undefined") {
    return { data: candidate.data, error: candidate.error };
  }
  return null;
}

function storageData<T>(result: unknown): T | null {
  const shaped = asStorageResult(result);
  return shaped ? (shaped.data as T | null) : null;
}

function storageError(result: unknown): unknown {
  const shaped = asStorageResult(result);
  return shaped ? shaped.error : result;
}

export async function uploadProfilePicture(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ProfilePictureResult> {
  if (!file) return { ok: false, reason: "no-file" };

  const authResult = await supabase.auth.getUser();
  const auth = storageData<{ user: { id: string } }>(authResult);
  if (storageError(authResult) || !auth?.user) {
    return { ok: false, reason: "not-signed-in" };
  }

  const userId = auth.user.id;
  const fileName = userId + "/" + crypto.randomUUID() + (file.name.includes(".") ? "" : ".png");
  const bucketName = "profile-pictures";

  const bucketsResult = await supabase.storage.listBuckets();
  const bucketRows = storageData<Array<{ id: string }>>(bucketsResult);
  if (storageError(bucketsResult) || !bucketRows || !bucketRows.some((row) => row.id === bucketName)) {
    return { ok: false, reason: "not-configured" };
  }

  const uploadResult = await supabase.storage.from(bucketName).upload(fileName, file, {
    contentType: file.type || "image/png",
    upsert: false,
  });
  const uploadError = storageError(uploadResult);
  const uploadData = storageData<unknown>(uploadResult);

  if (uploadError || !uploadData) {
    return { ok: false, reason: "upload-failed" };
  }

  const publicResult = supabase.storage.from(bucketName).getPublicUrl(fileName);
  const publicData = storageData<{ publicUrl?: string }>(publicResult);
  if (!publicData || !publicData.publicUrl) {
    return { ok: false, reason: "upload-failed" };
  }

  return { ok: true, url: publicData.publicUrl };
}
