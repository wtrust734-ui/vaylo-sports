// ============================================================================
// THE TROPHY ROOM, RENDERED
// ----------------------------------------------------------------------------
// The structural test next door proves which file owns which shelf. This one
// proves the case actually shows the three kinds of trophy and that the share
// actions carry the right words — including the whole-case summary, which is the
// only place the counts are put in a sentence.
// ============================================================================

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SharePayload = { title?: string; text?: string; url?: string };
const shareWithInvite = vi.fn(async (_payload: SharePayload) => "shared" as const);

vi.mock("@/lib/share", () => ({
  shareWithInvite: (payload: SharePayload) => shareWithInvite(payload),
}));

vi.mock("@/hooks/useAchievementStats", () => ({
  useAchievementStats: () => ({
    earnedIds: new Set(["first_workout", "mental_owner"]),
    completedChallenges: [
      { id: "c1", title: "Seven Day Streak", description: "Train seven days in a row", icon: "flame" },
    ],
  }),
}));

import TrophyRoom from "./TrophyRoom";

beforeEach(() => {
  shareWithInvite.mockClear();
});

describe("the Trophy Room", () => {
  it("shows earned medals, Market ownership and finished challenges in one case", () => {
    render(<TrophyRoom />);

    expect(screen.getByRole("heading", { name: "Achievements" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Status & ownership/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Challenges" })).toBeInTheDocument();

    // One from each shelf, by name.
    expect(screen.getByText("First Steps")).toBeInTheDocument();
    expect(screen.getByText("Mental Gym Owner")).toBeInTheDocument();
    expect(screen.getByText("Seven Day Streak")).toBeInTheDocument();

    // A medal the account does not hold must not be in the case.
    expect(screen.queryByText("Centurion")).not.toBeInTheDocument();
  });

  it("shares a single trophy with its own name", async () => {
    render(<TrophyRoom />);

    fireEvent.click(screen.getByRole("button", { name: "Share First Steps" }));

    await waitFor(() => expect(shareWithInvite).toHaveBeenCalledTimes(1));
    const payload = shareWithInvite.mock.calls[0]?.[0];
    expect(payload?.text).toContain("First Steps");
    expect(payload?.title).toContain("Trophy Room");
  });

  it("shares a market trophy and a challenge as themselves", async () => {
    render(<TrophyRoom />);

    fireEvent.click(screen.getByRole("button", { name: "Share Mental Gym Owner" }));
    await waitFor(() => expect(shareWithInvite).toHaveBeenCalledTimes(1));
    expect(shareWithInvite.mock.calls[0]?.[0]?.text).toContain("Mental Gym Owner");

    fireEvent.click(screen.getByRole("button", { name: "Share Seven Day Streak" }));
    await waitFor(() => expect(shareWithInvite).toHaveBeenCalledTimes(2));
    expect(shareWithInvite.mock.calls[1]?.[0]?.text).toContain("Seven Day Streak");
  });

  it("shares the whole case with the counts it is showing", async () => {
    render(<TrophyRoom />);

    fireEvent.click(screen.getByRole("button", { name: /^Share$/ }));
    await waitFor(() => expect(shareWithInvite).toHaveBeenCalledTimes(1));

    const payload = shareWithInvite.mock.calls[0]?.[0];
    expect(payload?.text).toContain("1 medals");
    expect(payload?.text).toContain("1 trophies from the Market");
    expect(payload?.text).toContain("1 challenges finished");
  });
});
