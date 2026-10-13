// ============================================================================
// THE HEALTH CONNECT POP-UP, RENDERED
// ----------------------------------------------------------------------------
// src/lib/healthConnectEntry.test.ts pins the wiring by reading sources. That
// cannot tell an athlete-visible truth about the sheet itself: whether the
// button somebody is asked to tap actually says what the request asked for, and
// whether tapping it reaches the hook instead of doing nothing.
//
// So this file renders it against a fake hook and a faked platform. The states
// that matter:
//
//   * Android, not connected  → the CTA, and a tap that calls connect()
//   * Android, connected      → Sync now, so the second visit is useful too
//   * sign-up, no session     → the same reads, but the footer ARMS the offer:
//                               connect() is a no-op before an account exists
//   * not Android             → the Android-only explanation, and NO CTA,
//                               because a connect button there can only fail
//
// The hook is faked rather than the bridge: this is a test of the sheet's
// contract with useHealthConnect(), which is the seam that matters. The real
// consent/sync/disconnect behaviour lives in src/lib/health/sync.ts and is
// covered by permissionContract.test.ts and androidNative.test.ts.
// ============================================================================

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import HealthConnectPrompt, {
  HEALTH_CONNECT_ARM_CTA,
  HEALTH_CONNECT_CTA,
} from "@/components/health/HealthConnectPrompt";
import { useHealthConnect, type UseHealthConnect } from "@/hooks/useHealthConnect";
import { isAndroid } from "@/lib/platform";

vi.mock("@/lib/platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform")>();
  return { ...actual, isAndroid: vi.fn(() => true) };
});

vi.mock("@/hooks/useHealthConnect", () => ({ useHealthConnect: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  (isAndroid as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
});

/** The hook's full surface, so a component reading one more field still renders. */
function hookState(overrides: Partial<UseHealthConnect> = {}): UseHealthConnect {
  return {
    status: "not_connected",
    apiStatus: "available",
    syncState: { lastSyncAt: null, cursorMs: null },
    consentOutdated: false,
    checking: false,
    connecting: false,
    syncing: false,
    error: null,
    connect: vi.fn().mockResolvedValue(undefined),
    sync: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    disconnecting: false,
    deleteImported: vi.fn().mockResolvedValue(true),
    deleting: false,
    managePermissions: vi.fn().mockResolvedValue(undefined),
    clearError: vi.fn(),
    ...overrides,
  };
}

const renderPrompt = (state: UseHealthConnect, onClose = vi.fn()) => {
  (useHealthConnect as unknown as ReturnType<typeof vi.fn>).mockReturnValue(state);
  render(
    <MemoryRouter>
      <HealthConnectPrompt open onClose={onClose} />
    </MemoryRouter>,
  );
  return { onClose };
};

describe("on Android, before connecting", () => {
  it("offers the exact call to action the request asked for", () => {
    renderPrompt(hookState());
    expect(screen.getByRole("button", { name: HEALTH_CONNECT_CTA })).toBeInTheDocument();
  });

  it("names every read it is about to ask for", () => {
    renderPrompt(hookState());
    for (const label of ["Workouts", "Heart rate", "Distance", "Steps", "Sleep", "Calories"]) {
      expect(screen.getByText(label), `${label} is not named before asking`).toBeInTheDocument();
    }
  });

  it("wires the tap to connect() — it is not a decorative button", async () => {
    const state = hookState();
    renderPrompt(state);
    // Awaited so the busy state the handler sets on the way out is flushed
    // inside the test rather than landing after it as an act() warning.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: HEALTH_CONNECT_CTA }));
    });
    expect(state.connect).toHaveBeenCalledTimes(1);
  });

  it("leaves a way out without connecting anything", () => {
    const { onClose } = renderPrompt(hookState());
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("surfaces a declined or failed grant instead of looking successful", () => {
    renderPrompt(hookState({ error: "connect_failed" }));
    expect(screen.getByText("connect_failed")).toBeInTheDocument();
  });

  it("sends an athlete whose Health Connect needs an update to it, not to a connect loop", () => {
    const state = hookState({ apiStatus: "update_required" });
    renderPrompt(state);
    expect(screen.queryByRole("button", { name: HEALTH_CONNECT_CTA })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open Health Connect/ }));
    expect(state.managePermissions).toHaveBeenCalledTimes(1);
  });
});

describe("once connected", () => {
  const connected = hookState({
    status: "connected",
    syncState: { lastSyncAt: "2026-10-10T07:00:00.000Z", cursorMs: 1 },
  });

  it("offers a sync rather than asking to connect a second time", async () => {
    renderPrompt(connected);
    expect(screen.queryByRole("button", { name: HEALTH_CONNECT_CTA })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Sync now/ }));
    });
    expect(connected.sync).toHaveBeenCalledTimes(1);
  });

  it("keeps disconnect reachable, and asks before doing it", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPrompt(connected);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Health Connect" }));
    expect(confirmSpy).toHaveBeenCalled();
    // Declined in the dialog = nothing stopped.
    expect(connected.disconnect).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("names the last sync so management has something to read", () => {
    renderPrompt(connected);
    expect(screen.getByText(/Last sync/)).toBeInTheDocument();
  });

  it("leaves the sheet, rather than trapping the athlete inside it", () => {
    // The complaint this covers: once connected, the sheet's only prominent
    // control was "Sync now" and the way out was a 28px-wide X in the header.
    // A pop-up reported as "it doesn't let me click the X" is a pop-up whose
    // footer offers no exit, so the exit is asserted here and not just assumed.
    const { onClose } = renderPrompt(connected);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    // ...and the header X still works, on both states.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("names what it is reading now that the grant exists", () => {
    // "Vaylo reads only what you approved" is only honest if the sheet says
    // what that is: the list of six used to be rendered on the connect path
    // alone, so the connected state pointed at something not on screen.
    renderPrompt(connected);
    expect(
      screen.getByText(
        /Reading Workouts · Heart rate · Distance · Steps · Sleep · Calories — nothing else\./,
      ),
    ).toBeInTheDocument();
  });

  it("deletes imported data from here, after confirming, and stays open", async () => {
    // The Wearables screen used to own this control. It now lives in the sheet,
    // so the sheet is the one place an athlete manages what Vaylo holds.
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const state = hookState({ status: "connected" });
    const { onClose } = renderPrompt(state);

    fireEvent.click(screen.getByRole("button", { name: "Delete imported data" }));
    await act(async () => {});

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(state.deleteImported).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("does nothing if the athlete cancels the confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const state = hookState({ status: "connected" });
    renderPrompt(state);

    fireEvent.click(screen.getByRole("button", { name: "Delete imported data" }));
    await act(async () => {});

    expect(state.deleteImported).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});

describe("on the sign-up screen, with no session yet", () => {
  it("previews the reads and arms the offer instead of offering a dead connect", () => {
    const onArm = vi.fn();
    const onClose = vi.fn();
    // The hook is meaningless here (there is no user to resolve against), which
    // is exactly the state it reports as "unavailable" on this screen.
    (useHealthConnect as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      hookState({ status: "unavailable" }),
    );
    render(
      <MemoryRouter>
        <HealthConnectPrompt open onClose={onClose} onArm={onArm} />
      </MemoryRouter>,
    );

    // No session exists to connect with, so the connect CTA could only fail.
    expect(screen.queryByRole("button", { name: HEALTH_CONNECT_CTA })).not.toBeInTheDocument();
    // The promise is still specific: every read is named before it is made.
    for (const label of ["Workouts", "Heart rate", "Distance", "Steps", "Sleep", "Calories"]) {
      expect(screen.getByText(label), `${label} is not named before the promise`).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("button", { name: HEALTH_CONNECT_ARM_CTA }));
    expect(onArm).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("on a build with no Health Connect", () => {
  it("explains the platform instead of offering a button that must fail", () => {
    (isAndroid as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    renderPrompt(hookState());
    expect(screen.queryByRole("button", { name: HEALTH_CONNECT_CTA })).not.toBeInTheDocument();
    expect(screen.getByText(/Health Connect runs on Android/)).toBeInTheDocument();
  });
});
