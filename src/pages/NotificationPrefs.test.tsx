import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  user: { id: "user-1" },
  upsert: vi.fn(async () => ({ error: null })),
  scheduleMorningReminders: vi.fn(async () => 0),
  scheduleStreakReminder: vi.fn(async () => 0),
  scheduleReengagementPing: vi.fn(async () => undefined),
  deviceNotificationsEnabled: vi.fn(async () => true),
}));

vi.mock("@/contexts/AuthContext", () => ({
  // Stable object: the real context memoises its user, and a new object on
  // every render would re-arm the prefs fetch effect forever.
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        limit: () => chain,
        maybeSingle: async () =>
          table === "training_plans"
            ? {
                data: {
                  id: "plan-1",
                  title: "Autumn plan",
                  sport: "Running",
                  week_current: 1,
                  duration_weeks: 8,
                  plan_data: [],
                },
              }
            : {
                data: {
                  workout_reminders: true,
                  friend_activity: true,
                  streak_alerts: true,
                  challenge_deadlines: true,
                  reengagement: true,
                  low_balance: true,
                  recovery_alerts: true,
                  quiet_start: "22:00:00",
                  quiet_end: "07:00:00",
                },
              },
        upsert: mocks.upsert,
      };
      return chain;
    },
  },
}));

vi.mock("@/lib/push", () => ({
  pushAvailability: vi.fn(async () => ({ available: true, configured: true, permission: "granted" })),
  registerPush: vi.fn(),
}));

vi.mock("@/lib/localNotifications", () => ({
  deviceNotificationsEnabled: mocks.deviceNotificationsEnabled,
  deviceNotificationsSupported: () => true,
  enableDeviceNotifications: vi.fn(),
}));

vi.mock("@/lib/notificationTriggers", () => ({
  scheduleMorningReminders: mocks.scheduleMorningReminders,
  scheduleStreakReminder: mocks.scheduleStreakReminder,
  scheduleReengagementPing: mocks.scheduleReengagementPing,
}));

vi.mock("@/lib/recoveryStreak", () => ({
  getCurrentStreak: () => ({ current: 4, longest: 4, checkInToday: true }),
}));

import NotificationPrefs from "./NotificationPrefs";

describe("Notification settings", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("does not offer to turn on reminders when the OS already granted them", async () => {
    render(<NotificationPrefs />);

    await waitFor(() => expect(mocks.deviceNotificationsEnabled).toHaveBeenCalled());
    expect(screen.getByText("Reminders are on for this device.")).toBeInTheDocument();
    expect(screen.queryByText(/Turn on reminders on this device/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Turn on notifications on this device/i)).not.toBeInTheDocument();
  });

  it("has no test-notification button", async () => {
    render(<NotificationPrefs />);
    await waitFor(() => expect(screen.getByText("Workout reminders")).toBeInTheDocument());
    expect(screen.queryByText(/Send a test notification/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Test from Vaylo/i)).not.toBeInTheDocument();
  });

  it("saves a switch and rewrites the OS timers with the new setting", async () => {
    render(<NotificationPrefs />);
    await waitFor(() => expect(screen.getByText("Workout reminders")).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole("switch")[0]);

    await waitFor(() => expect(mocks.upsert).toHaveBeenCalled());
    await waitFor(() =>
      expect(mocks.scheduleMorningReminders).toHaveBeenCalledWith(
        expect.objectContaining({ id: "plan-1" }),
        expect.objectContaining({ workout_reminders: false }),
        expect.any(Date),
        true,
      ),
    );
  });
});
