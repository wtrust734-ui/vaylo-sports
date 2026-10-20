// ============================================================================
// api.ts — every Ads Studio call to the real backend in one typed client.
// ----------------------------------------------------------------------------
// Rules enforced here, for every consumer:
//   • chat/classification/brand/integration calls go through Edge Functions
//     (server-side auth, rate limits and keys — never keys in the browser);
//   • campaigns go through ad-campaigns (owner-scoped RLS, owner from JWT);
//   • library rows and storage go direct to Supabase with RLS/storage
//     policies — the client can only ever touch its own folders;
//   • failures are mapped through edgeErrorMessage so a provider outage reads
//     as a human message instead of a stack trace.
// ============================================================================

import { supabase } from "@/integrations/supabase/client";
import { edgeErrorMessage } from "@/lib/edgeErrors";

// --------------------------------------------------------------------------
// Chat
// --------------------------------------------------------------------------

export interface PlanStepDTO {
  type: string;
  options: Record<string, unknown>;
}

export interface AssistantMessage {
  id: string;
  role: "assistant";
  content: string;
  createdAt: string;
  intent: string;
  plan: PlanStepDTO[];
  clarification: string | null;
  classificationSource: "model" | "rules" | "rules_fallback";
}

export interface ChatResponse {
  sessionId: string;
  assistant: AssistantMessage;
}

export async function sendChatMessage(sessionId: string | null, content: string): Promise<ChatResponse> {
  const { data, error } = await supabase.functions.invoke("ads-chat", {
    body: { sessionId: sessionId ?? undefined, content },
  });
  if (error) throw new Error(await edgeErrorMessage(error));
  return data as ChatResponse;
}

//캠페인 생성 내용을 저장하고, 채팅 세션의 plan에 campaignId를 넣어 추적한다.
export async function routeCampaignFromChat(sessionId: string | null, content: string): Promise<{ campaignId: string | null; status: string | null; assistantReply: string }> {
  const { data, error } = await supabase.functions.invoke("ads-chat", {
    body: { sessionId: sessionId ?? undefined, content, type: "campaign" },
  });
  if (error) {
    const msg = await edgeErrorMessage(error);
    throw new Error(msg);
  }
  const payload = data as { campaignId?: string | null; status?: string | null; assistant?: { reply?: string } };
  return {
    campaignId: payload?.campaignId ?? null,
    status: payload?.status ?? null,
    assistantReply: payload?.assistant?.reply ?? "",
  };
}

// --------------------------------------------------------------------------
// Brand settings
// --------------------------------------------------------------------------

export interface BrandConfig {
  name: string;
  slogan: string;
  description: string;
  positioning: string;
  toneOfVoice: string;
  targetAudience: string;
  typography: string;
  colors: { black: string; navy: string; purple: string };
  approvedCtas: string[];
  prohibitedClaims: string[];
  logoPath: string | null;
}

export async function fetchBrand(): Promise<{ brand: BrandConfig; isDefault: boolean; updatedAt: string | null }> {
  const { data, error } = await supabase.functions.invoke("ads-brand", { method: "GET" });
  if (error) throw new Error(await edgeErrorMessage(error));
  return data as { brand: BrandConfig; isDefault: boolean; updatedAt: string | null };
}

export async function saveBrand(config: BrandConfig): Promise<BrandConfig> {
  const { data, error } = await supabase.functions.invoke("ads-brand", {
    method: "PUT",
    body: config,
  });
  if (error) throw new Error(await edgeErrorMessage(error));
  return (data as { brand: BrandConfig }).brand;
}

// --------------------------------------------------------------------------
// Integrations
// --------------------------------------------------------------------------

export interface IntegrationStatus {
  provider: string;
  purpose: string;
  secret: string;
  configured: boolean;
  missing?: string;
  verified?: string;
  unverified?: string;
}

export async function fetchIntegrations(): Promise<{ integrations: IntegrationStatus[]; summary: string }> {
  const { data, error } = await supabase.functions.invoke("ads-integrations", { method: "GET" });
  if (error) throw new Error(await edgeErrorMessage(error));
  return data as { integrations: IntegrationStatus[]; summary: string };
}

// --------------------------------------------------------------------------
// Campaigns — existing ad-campaigns function (owner-scoped)
// --------------------------------------------------------------------------

export interface Campaign {
  id: string;
  name: string;
  objective: string;
  audience: string;
  platform: string;
  budget_usd: number;
  message: string;
  call_to_action: string;
  status: "draft" | "planning" | "approved" | "rendering" | "done" | "failed";
  brief?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function listCampaigns(): Promise<Campaign[]> {
  const { data, error } = await supabase.functions.invoke("ad-campaigns", { method: "GET" });
  if (error) throw new Error(await edgeErrorMessage(error));
  return ((data as { campaigns: Campaign[] }).campaigns ?? []) as Campaign[];
}

export async function createCampaign(
  input: Pick<Campaign, "name" | "objective" | "audience" | "platform" | "budget_usd" | "message" | "call_to_action"> & {
    brief?: Record<string, unknown>;
  },
): Promise<Campaign> {
  const { data, error } = await supabase.functions.invoke("ad-campaigns", { body: { ...input, status: "planning" } });
  if (error) throw new Error(await edgeErrorMessage(error));
  return (data as { campaign: Campaign }).campaign;
}

export async function updateCampaign(id: string, patch: Partial<Campaign>): Promise<Campaign> {
  const { data, error } = await supabase.functions.invoke("ad-campaigns", { method: "PATCH", body: { id, ...patch } });
  if (error) throw new Error(await edgeErrorMessage(error));
  return (data as { campaign: Campaign }).campaign;
}

export async function deleteCampaign(id: string): Promise<void> {
  const { error } = await supabase.functions.invoke("ad-campaigns", { method: "DELETE", body: { id } });
  if (error) throw new Error(await edgeErrorMessage(error));
}

// --------------------------------------------------------------------------
// Asset library — direct supabase-js (RLS + storage policies), looser typing
// because the studio tables are new; generated Database types catch up next
// time `supabase gen types` runs.
// --------------------------------------------------------------------------

export type LibraryKind = "image" | "video" | "audio" | "script" | "storyboard" | "document";

export interface LibraryItem {
  id: string;
  owner_id: string;
  campaign_id: string | null;
  kind: LibraryKind;
  name: string;
  storage_path: string;
  mime: string | null;
  size_bytes: number | null;
  duration_seconds: number | null;
  status: "processing" | "ready" | "failed";
  metadata: Record<string, unknown>;
  created_at: string;
}

function rawFrom(table: string) {
  const anyClient = supabase as any;
  return anyClient.from(table);
}

export const LIBRARY_BUCKET = "ads";

export async function listLibrary(filter?: { kind?: LibraryKind; search?: string }): Promise<LibraryItem[]> {
  let q: any = rawFrom("ad_library_items").select("*").order("created_at", { ascending: false }).limit(200);
  if (filter?.kind) q = q.eq("kind", filter.kind);
  if (filter?.search) q = q.ilike("name", `%${filter.search}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as LibraryItem[];
}

export async function uploadLibraryItem(file: File, kind: LibraryKind, campaignId?: string | null, name?: string): Promise<LibraryItem> {
  const { data: sessionData } = await supabase.auth.getSession();
  const uid = sessionData.session?.user.id;
  if (!uid) throw new Error("Sign in to upload assets");
  // Server-side rules mirrored client-side: 100 MB ceiling, image/video/audio/doc types only.
  const MAX_BYTES = 100 * 1024 * 1024;
  if (file.size > MAX_BYTES) throw new Error("File is over the 100 MB limit");
  const allowed = ["image/", "video/", "audio/", "application/pdf", "text/plain"];
  if (!allowed.some((p) => file.type.startsWith(p))) throw new Error("That file type is not supported");

  const path = `ads/${uid}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\- ]+/g, "_")}`.toString();
  const { error: upErr } = await supabase.storage
    .from(LIBRARY_BUCKET)
    .upload(path.replace(/^ads\//, ""), file, { contentType: file.type });
  if (upErr) throw new Error(upErr.message);
  const realPath = path.replace(/^ads\//, "");

  const insert = rawFrom("ad_library_items").insert({
    owner_id: uid,
    campaign_id: campaignId && campaignId.length === 36 ? campaignId : null,
    kind,
    name: (name ?? file.name).slice(0, 180),
    storage_path: realPath,
    mime: file.type || null,
    size_bytes: file.size,
    status: "ready",
  } as never).select().single();

  const { data, error } = await (insert as any);
  if (error) {
    // Best-effort cleanup so a failed row never leaves an orphan object.
    await supabase.storage.from(LIBRARY_BUCKET).remove([realPath]);
    throw new Error(error.message);
  }
  return data as LibraryItem;
}

export async function deleteLibraryItem(item: LibraryItem): Promise<void> {
  const { error: rowErr } = await rawFrom("ad_library_items").delete().eq("id", item.id);
  if (rowErr) throw new Error(rowErr.message);
  const { error: storErr } = await supabase.storage.from(LIBRARY_BUCKET).remove([item.storage_path]);
  if (storErr) throw new Error(storErr.message);
}

export async function librarySignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(LIBRARY_BUCKET).createSignedUrl(storagePath, 60 * 60);
  if (error || !data) throw new Error("Could not create a download link for that asset");
  return data.signedUrl;
}

/** Chat sessions list for the sidebar (RLS-scoped to the owner). */
export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export async function listChatSessions(): Promise<ChatSession[]> {
  const { data, error } = await (rawFrom("ad_chat_sessions").select("id, title, created_at, updated_at").order("updated_at", { ascending: false }).limit(30) as any);
  if (error) throw new Error(error.message);
  return (data ?? []) as ChatSession[];
}

export interface StoredChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  intent: string | null;
  plan: Record<string, unknown>;
  created_at: string;
}

export async function listChatMessages(sessionId: string | null): Promise<StoredChatMessage[]> {
  const { data, error } = await (rawFrom("ad_chat_messages")
    .select("*").eq("session_id", sessionId ?? "").order("created_at", { ascending: true }) as any);
  if (error) throw new Error(error.message);
  return (data ?? []) as StoredChatMessage[];
}