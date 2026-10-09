import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useAiIntent } from "@/hooks/useAiIntent";
import { readAiIntent } from "./aiIntent";

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
const create = () => ({ id: "stable-uuid", request: { request_id: "stable-uuid", instruction: "Ease off" }, context: { planId: "plan-1" } });
const useIntent = (user = "athlete-a") => useAiIntent<ReturnType<typeof create>["request"], { weeks: number[] }, { planId: string }>(user, "edit-plan:plan-1");

it("keeps the same payload and ID after a lost response, remount and edited form", () => {
  const first = renderHook(() => useIntent());
  act(() => { first.result.current.begin(create); });
  first.unmount();
  const second = renderHook(() => useIntent());
  const replacement = vi.fn(() => ({ ...create(), id: "new-uuid" }));
  expect(second.result.current.begin(replacement)).toEqual(create());
  expect(replacement).not.toHaveBeenCalled();
  expect(second.result.current.pending?.request.instruction).toBe("Ease off");
});
it("retains successful output after a failed save and removes only the completed intent", () => {
  const first = renderHook(() => useIntent());
  act(() => { first.result.current.save({ ...create(), result: { weeks: [1, 2] } }); });
  first.unmount();
  const second = renderHook(() => useIntent());
  expect(second.result.current.pending?.result).toEqual({ weeks: [1, 2] });
  act(() => { second.result.current.complete("different-id"); });
  expect(second.result.current.pending).not.toBeNull();
  act(() => { second.result.current.complete("stable-uuid"); });
  expect(readAiIntent("athlete-a", "edit-plan:plan-1")).toBeNull();
});
it("isolates accounts and rejects stale results even after switching back", () => {
  const hook = renderHook(({ user }) => useIntent(user), { initialProps: { user: "athlete-a" } });
  act(() => { hook.result.current.begin(create); });
  const old = hook.result.current;
  hook.rerender({ user: "athlete-b" });
  expect(hook.result.current.pending).toBeNull();
  expect(old.isCurrent()).toBe(false);
  expect(() => old.save({ ...create(), result: { weeks: [1] } })).toThrow(/changed/);
  hook.rerender({ user: "athlete-a" });
  expect(old.isCurrent()).toBe(false);
  expect(hook.result.current.pending?.id).toBe("stable-uuid");
});
it("blocks execution if the intent cannot be persisted and preserves an intent if result storage fails", () => {
  const hook = renderHook(() => useIntent());
  const set = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => { throw new Error("quota"); });
  expect(() => hook.result.current.begin(create)).toThrow("quota");
  act(() => { hook.result.current.begin(create); });
  set.mockImplementationOnce(() => { throw new Error("quota"); });
  expect(() => hook.result.current.save({ ...create(), result: { weeks: [1] } })).toThrow("quota");
  expect(readAiIntent("athlete-a", "edit-plan:plan-1")).toEqual(create());
});
it("does not replace a corrupt pending record or persist after unmount", () => {
  localStorage.setItem("vaylo_ai_intent:athlete-a:edit-plan:plan-1", "broken");
  const hook = renderHook(() => useIntent());
  expect(hook.result.current.error).toBeTruthy();
  expect(() => hook.result.current.begin(create)).toThrow();
  const old = hook.result.current;
  hook.unmount();
  expect(old.isCurrent()).toBe(false);
});

it("does not create a new intent when another tab owns the operation", async () => {
  const lock = vi.fn(async (_key, _options, callback) => callback(null));
  vi.stubGlobal("navigator", { locks: { request: lock } });
  try {
    const hook = renderHook(() => useIntent());
    const work = vi.fn(async () => { hook.result.current.begin(create); });
    await expect(hook.result.current.run(work)).rejects.toThrow(/another tab/);
    expect(work).not.toHaveBeenCalled();
    expect(readAiIntent("athlete-a", "edit-plan:plan-1")).toBeNull();
  } finally { vi.unstubAllGlobals(); }
});
