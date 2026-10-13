import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  native: true,
  plugin: null as null | Record<string, ReturnType<typeof vi.fn>>,
}));

vi.mock("@/lib/platform", () => ({
  isNative: () => h.native,
  loadPlugin: async () => h.plugin,
}));

type Mod = typeof import("./localNotifications");

/** The module keeps permission/channel state per app run, so load it fresh. */
const load = async (): Promise<Mod> => {
  vi.resetModules();
  return import("./localNotifications");
};

const makePlugin = (display: string) => ({
  checkPermissions: vi.fn(async () => ({ display })),
  requestPermissions: vi.fn(async () => ({ display: "granted" })),
  createChannel: vi.fn(async () => undefined),
  schedule: vi.fn(async () => ({})),
  addListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
});

describe("showDeviceNotification", () => {
  beforeEach(() => {
    h.native = true;
    h.plugin = makePlugin("granted");
    vi.useRealTimers();
  });

  it("schedules an explicit time so the OS posts it, on the reminders channel", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T10:00:00.000Z"));
    const { showDeviceNotification, LOCAL_CHANNEL_REMINDERS } = await load();

    const outcome = await showDeviceNotification({
      title: "Streak at risk",
      body: "Log today's session to keep it.",
      link: "/train",
    });

    expect(outcome).toBe("shown");
    expect(h.plugin!.schedule).toHaveBeenCalledTimes(1);
    const [arg] = h.plugin!.schedule.mock.calls[0] as unknown as [
      { notifications: Array<Record<string, unknown>> },
    ];
    const n = arg.notifications[0];
    expect(n.title).toBe("Streak at risk");
    expect(n.body).toBe("Log today's session to keep it.");
    expect(n.channelId).toBe(LOCAL_CHANNEL_REMINDERS);
    expect(n.extra).toEqual({ link: "/train" });
    const at = (n.schedule as { at: Date }).at;
    expect(at.getTime()).toBe(new Date("2026-10-13T10:00:01.000Z").getTime());
    expect(Number.isInteger(n.id)).toBe(true);
    vi.useRealTimers();
  });

  it("creates the reminders channel before posting", async () => {
    const { showDeviceNotification, LOCAL_CHANNEL_REMINDERS } = await load();
    await showDeviceNotification({ title: "t", body: "b" });
    expect(h.plugin!.createChannel).toHaveBeenCalledWith(
      expect.objectContaining({ id: LOCAL_CHANNEL_REMINDERS }),
    );
  });

  it("asks for permission once, and reports denied without posting", async () => {
    h.plugin = makePlugin("prompt");
    h.plugin.requestPermissions.mockResolvedValue({ display: "denied" });
    const { showDeviceNotification } = await load();

    expect(await showDeviceNotification({ title: "t", body: "b" })).toBe("denied");
    expect(await showDeviceNotification({ title: "t", body: "b" })).toBe("denied");
    expect(h.plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(h.plugin.schedule).not.toHaveBeenCalled();
  });

  it("reports unsupported on the web without touching the plugin", async () => {
    h.native = false;
    const { showDeviceNotification } = await load();
    expect(await showDeviceNotification({ title: "t", body: "b" })).toBe("unsupported");
    expect(h.plugin!.schedule).not.toHaveBeenCalled();
  });

  it("never throws when the OS rejects the post", async () => {
    h.plugin!.schedule.mockRejectedValueOnce(new Error("boom"));
    const { showDeviceNotification } = await load();
    await expect(showDeviceNotification({ title: "t", body: "b" })).resolves.toBe("failed");
  });
});

describe("enableDeviceNotifications", () => {
  beforeEach(() => {
    h.native = true;
    h.plugin = makePlugin("prompt");
  });

  it("requests permission and creates the channel without posting anything", async () => {
    const { enableDeviceNotifications } = await load();
    expect(await enableDeviceNotifications()).toBe("shown");
    expect(h.plugin!.requestPermissions).toHaveBeenCalledTimes(1);
    expect(h.plugin!.createChannel).toHaveBeenCalledTimes(1);
    expect(h.plugin!.schedule).not.toHaveBeenCalled();
  });
});

describe("installNotificationTapHandler", () => {
  beforeEach(() => {
    h.native = true;
    h.plugin = makePlugin("granted");
  });

  it("passes the tapped link through to the handler", async () => {
    let listener: ((e: { notification?: { extra?: Record<string, unknown> } }) => void) | null =
      null;
    h.plugin!.addListener.mockImplementation(async (_name: string, fn: typeof listener) => {
      listener = fn;
      return { remove: vi.fn(async () => undefined) };
    });
    const { installNotificationTapHandler } = await load();
    const onOpen = vi.fn();
    installNotificationTapHandler(onOpen);
    await vi.waitFor(() => expect(listener).not.toBeNull());

    listener!({ notification: { extra: { link: "/coach" } } });
    listener!({ notification: { extra: {} } });
    expect(onOpen).toHaveBeenNthCalledWith(1, "/coach");
    expect(onOpen).toHaveBeenNthCalledWith(2, null);
  });

  it("removes the listener when cleaned up after it has registered", async () => {
    const remove = vi.fn(async () => undefined);
    h.plugin!.addListener.mockResolvedValue({ remove });
    const { installNotificationTapHandler } = await load();
    const cleanup = installNotificationTapHandler(vi.fn());
    await vi.waitFor(() => expect(h.plugin!.addListener).toHaveBeenCalled());
    await Promise.resolve();
    cleanup();
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  });

  it("removes the listener when cleanup runs before registration resolves", async () => {
    const remove = vi.fn(async () => undefined);
    let resolveAdd: (v: { remove: () => Promise<void> }) => void = () => undefined;
    h.plugin!.addListener.mockImplementation(
      () => new Promise((resolve) => (resolveAdd = resolve)),
    );
    const { installNotificationTapHandler } = await load();
    const cleanup = installNotificationTapHandler(vi.fn());
    await vi.waitFor(() => expect(h.plugin!.addListener).toHaveBeenCalled());
    cleanup();
    resolveAdd({ remove });
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  });
});
