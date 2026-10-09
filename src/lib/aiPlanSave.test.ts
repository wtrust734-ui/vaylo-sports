import { beforeEach, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: db }));
import { saveAiNutritionPlan, saveAiPlanEdit } from "./aiPlanSave";
const query = (reply: unknown) => {
  const q = { update: vi.fn(), insert: vi.fn(), select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => reply), single: vi.fn(async () => reply) };
  q.update.mockReturnValue(q); q.select.mockReturnValue(q); q.eq.mockReturnValue(q); q.insert.mockResolvedValue(reply);
  return q;
};
beforeEach(() => vi.resetAllMocks());
it("conditionally saves against the original plan snapshot", async () => {
  const q = query({ data: { id: "plan" }, error: null }); db.from.mockReturnValue(q);
  await saveAiPlanEdit("athlete", "plan", [1], [2]);
  expect(q.eq).toHaveBeenCalledWith("plan_data", "[1]");
  expect(q.eq).toHaveBeenCalledWith("user_id", "athlete");
  expect(db.from).toHaveBeenCalledTimes(1);
});
it("recognizes a previously committed edit after a lost save response", async () => {
  const before = query({ data: null, error: null }), replay = query({ data: { id: "plan" }, error: null });
  db.from.mockReturnValueOnce(before).mockReturnValueOnce(replay);
  await saveAiPlanEdit("athlete", "plan", [1], [2]);
  expect(replay.eq).toHaveBeenCalledWith("plan_data", "[2]");
  expect(replay.update).not.toHaveBeenCalled();
});
it("retains the result on conflicts instead of overwriting later changes", async () => {
  const q = query({ data: null, error: null }); db.from.mockReturnValue(q);
  await expect(saveAiPlanEdit("athlete", "plan", [1], [2])).rejects.toThrow(/changed/);
  expect(q.update).toHaveBeenCalledTimes(1);
});
it("uses the same nutrition row ID when an insert response is lost", async () => {
  const insert = query({ error: { code: "23505" } }), existing = query({ data: { id: "intent" }, error: null });
  db.from.mockReturnValueOnce(insert).mockReturnValueOnce(existing);
  await saveAiNutritionPlan({ id: "intent", user_id: "athlete", title: "Plan", goal: "maintain" });
  expect(insert.insert).toHaveBeenCalledWith(expect.objectContaining({ id: "intent" }));
  expect(existing.eq).toHaveBeenCalledWith("id", "intent");
  expect(existing.eq).toHaveBeenCalledWith("user_id", "athlete");
});
it("does not report success on a save failure or an unconfirmed duplicate", async () => {
  db.from.mockReturnValue(query({ error: { code: "offline" } }));
  await expect(saveAiNutritionPlan({ id: "intent", user_id: "athlete", title: "Plan", goal: "maintain" })).rejects.toEqual({ code: "offline" });
  db.from.mockReturnValueOnce(query({ error: { code: "23505" } })).mockReturnValueOnce(query({ data: null, error: null }));
  await expect(saveAiNutritionPlan({ id: "intent", user_id: "athlete", title: "Plan", goal: "maintain" })).rejects.toThrow(/confirm/);
});
