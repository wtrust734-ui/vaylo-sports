import { act, render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  profile: vi.fn(), entitlements: vi.fn(), purchases: vi.fn(), initial: vi.fn(),
  emit: null as null | ((event: string, session: Session | null) => void),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: {
    getSession: () => mocks.initial(),
    onAuthStateChange: (fn: typeof mocks.emit) => { mocks.emit = fn; return { data: { subscription: { unsubscribe() {} } } }; },
  },
  rpc: () => mocks.entitlements(),
  from: (table: string) => ({ select: () => ({ eq: (_: string, id: string) => table === "profiles"
    ? { maybeSingle: () => mocks.profile(id) } : mocks.purchases(id) }) }),
} }));
vi.mock("@/lib/push", () => ({ unregisterPush: vi.fn() }));
vi.mock("@/lib/guestMode", () => ({ guestEntryAvailable: () => false, isGuestUser: () => false, GUEST_DISPLAY_NAME: "Guest" }));
vi.mock("@/lib/demoMode", () => ({ DEMO_MODE: false }));
import { AuthProvider, useAuth } from "./AuthContext";
import { SubscriptionProvider, useSubscription } from "./SubscriptionContext";

const session = (id: string) => ({ user: { id, user_metadata: {} }, access_token: "synthetic" }) as Session;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
let auth: ReturnType<typeof useAuth>;
let subscription: ReturnType<typeof useSubscription>;
function Probe() { auth = useAuth(); subscription = useSubscription(); return null; }
const mount = () => render(<AuthProvider><SubscriptionProvider><Probe /></SubscriptionProvider></AuthProvider>);
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.initial.mockResolvedValue({ data: { session: session("A") } });
  mocks.profile.mockImplementation((id) => Promise.resolve({ data: { user_id: id }, error: null }));
  mocks.entitlements.mockResolvedValue({ data: { plan_key: "free", credits: 12 }, error: null });
  mocks.purchases.mockResolvedValue({ data: [{ product_id: "nutrition_pack" }], error: null });
});

describe("account request ownership", () => {
  it("ignores a delayed profile from the previous account", async () => {
    const delayed = deferred<unknown>();
    mocks.profile.mockImplementation((id) => id === "A" ? delayed.promise : Promise.resolve({ data: { user_id: id }, error: null }));
    await act(async () => { mount(); });
    await act(async () => { mocks.emit!("SIGNED_IN", session("B")); });
    await act(async () => { delayed.resolve({ data: { user_id: "A" }, error: null }); });
    expect(auth.user?.id).toBe("B");
    expect(auth.profile?.user_id).toBe("B");
  });

  it("does not restore profile data after sign-out", async () => {
    const delayed = deferred<unknown>();
    mocks.profile.mockReturnValue(delayed.promise);
    await act(async () => { mount(); });
    await act(async () => { mocks.emit!("SIGNED_OUT", null); });
    await act(async () => { delayed.resolve({ data: { user_id: "A" }, error: null }); });
    expect(auth.user).toBeNull();
    expect(auth.profile).toBeNull();
  });

  it("ignores an initial session read that finishes after a newer auth event", async () => {
    const delayed = deferred<unknown>();
    mocks.initial.mockReturnValue(delayed.promise);
    await act(async () => { mount(); });
    await act(async () => { mocks.emit!("SIGNED_IN", session("B")); });
    await act(async () => { delayed.resolve({ data: { session: session("A") } }); });
    expect(auth.user?.id).toBe("B");
  });

  it("retains known entitlements on returned Supabase errors and exposes the failure", async () => {
    await act(async () => { mount(); });
    expect(subscription.entitlements.credits).toBe(12);
    expect(subscription.hasFeature("nutrition_pack")).toBe(true);
    mocks.entitlements.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    await act(async () => { await subscription.refresh(); });
    expect(subscription.entitlements.credits).toBe(12);
    expect(subscription.hasFeature("nutrition_pack")).toBe(true);
    expect(subscription.error).toBe("unavailable");
  });

  it("never carries old purchases into another account when its fetch fails", async () => {
    await act(async () => { mount(); });
    mocks.purchases.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    await act(async () => { mocks.emit!("SIGNED_IN", session("B")); });
    expect(subscription.hasFeature("nutrition_pack")).toBe(false);
    expect(subscription.entitlements.credits).toBe(0);
  });

  it("discards a delayed entitlement refresh after an account change", async () => {
    await act(async () => { mount(); });
    const delayed = deferred<unknown>();
    mocks.entitlements.mockReturnValueOnce(delayed.promise);
    let refresh!: Promise<void>;
    await act(async () => { refresh = subscription.refresh(); });
    mocks.entitlements.mockResolvedValue({ data: { credits: 7 }, error: null });
    await act(async () => { mocks.emit!("SIGNED_IN", session("B")); });
    await act(async () => { delayed.resolve({ data: { credits: 999 }, error: null }); await refresh; });
    expect(subscription.entitlements.credits).toBe(7);
  });
});
