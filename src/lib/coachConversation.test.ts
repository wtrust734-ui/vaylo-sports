import { beforeEach, expect, it, vi } from "vitest";
const insert = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ insert }) } }));
import { assistantReply, coachContext, saveAssistantReply, type CoachMessage } from "./coachConversation";
import { clearQueue, flushQueue, pendingWrites } from "./offlineQueue";

beforeEach(() => { clearQueue(); insert.mockReset(); });
it("keeps the latest prompt and recent complete exchanges in a bounded context", () => {
  const history: CoachMessage[] = Array.from({ length: 100 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: String(i) }));
  const prompt: CoachMessage = { role: "user", content: "next" };
  expect(coachContext(history, prompt)).toEqual([...history.slice(-38), prompt]);
  expect(history).toHaveLength(100);
  expect(coachContext([], prompt)).toEqual([prompt]);
});
it("keeps a reply durable while offline and sends it after reconnect", async () => {
  insert.mockResolvedValueOnce({ error: new TypeError("Failed to fetch") });
  const reply = assistantReply("user", "conversation", "Your reply");
  expect(await saveAssistantReply(reply)).toMatchObject({ ok: true, queued: true });
  expect(pendingWrites()[0].values).toEqual(reply);
  insert.mockResolvedValueOnce({ error: null });
  expect(await flushQueue()).toBe(1);
  expect(pendingWrites()).toEqual([]);
});
it("surfaces a failed reply save and preserves identity for retry", async () => {
  insert.mockResolvedValueOnce({ error: { message: "permission denied", code: "42501" } });
  const reply = assistantReply("user", "conversation", "Your reply");
  expect(await saveAssistantReply(reply)).toMatchObject({ ok: false });
  insert.mockResolvedValueOnce({ error: null });
  expect(await saveAssistantReply(reply)).toMatchObject({ ok: true, id: reply.id });
});
