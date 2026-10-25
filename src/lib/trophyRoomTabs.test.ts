// ============================================================================
// THE TROPHY ROOM IS THREE SCREENS, NOT FOUR
// ----------------------------------------------------------------------------
// Achievements (the catalogue), the Trophy Room (everything actually on the
// account — medals, Market ownership and finished challenges) and Challenges
// (joined). Three routes, three files.
//
// Badges used to be a fourth. It was the purchased half of the case, split into
// its own tab, which made "what do I own?" a navigation question with three
// different answers. It is now a shelf of the Trophy Room, and this file is what
// notices if it creeps back out.
//
// Asserted on the source rather than on a render, because the thing being
// prevented is structural: a section creeping back into another section's page,
// or a route being reintroduced. A render test would need a signed-in athlete,
// sixteen Supabase reads and a router; what actually has to stay true is which
// file owns which shelf, and that is legible in the source.
// ============================================================================

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** Comments explain the split, so they must not be what a test reads. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const ACHIEVEMENTS = "src/pages/Achievements.tsx";
const CHALLENGES = "src/pages/Challenges.tsx";
const TROPHY = "src/pages/TrophyRoom.tsx";
const APP = "src/App.tsx";
const PERFORM = "src/pages/Perform.tsx";

describe("the Trophy Room's three screens", () => {
  it("has no Badges screen or route left", () => {
    expect(existsSync(resolve(process.cwd(), "src/pages/Badges.tsx"))).toBe(false);

    const app = code(APP);
    expect(app).not.toMatch(/import\("\.\/pages\/Badges"\)/);
    expect(app).not.toMatch(/<Badges\s*\/>/);
    // The route survives only as a redirect into the case that owns the shelf.
    expect(app).toMatch(/path="\/badges"\s+element=\{<Navigate to="\/trophies" replace \/>\}/);
  });

  it("routes each remaining screen to its own screen", () => {
    const app = code(APP);
    expect(app).toContain('path="/achievements"');
    expect(app).toContain('path="/trophies"');
    expect(app).toContain('path="/challenges"');
    expect(app).toMatch(/import\("\.\/pages\/Achievements"\)/);
    expect(app).toMatch(/import\("\.\/pages\/TrophyRoom"\)/);
  });

  it("keeps the catalogue and the trophy case as separate screens", () => {
    // Achievements is the full list (locked rows included); the Trophy Room is
    // only what the account holds.
    const achievements = code(ACHIEVEMENTS);
    expect(achievements).toContain("achievementShelf");
    // The catalogue filters across the whole shelf, so it can show locked rows.
    expect(achievements).toContain('"Locked"');

    const trophy = code(TROPHY);
    expect(trophy).toContain("earnedIds.has");
    expect(trophy).toContain("achievementShelf");
    expect(trophy).toContain("marketShelf");
  });

  it("shows what was bought from the Market in the case, marked as earned", () => {
    // The shelf moved here from the deleted Badges screen; it must still be the
    // purchase ids, not the whole catalogue relabelled.
    const trophy = code(TROPHY);
    expect(trophy).toContain("Owned from the Market");
    expect(trophy).toContain("ownedMarket");
    expect(trophy).toContain("marketShelf");
    expect(trophy).toContain("earnedIds");
  });

  it("lists finished challenges in the case", () => {
    const trophy = code(TROPHY);
    expect(trophy).toContain("completedChallenges");
    expect(trophy).toContain("Challenges");
    // Named rows, not just a count: "3" is not a trophy.
    expect(trophy).toContain("challenge.title");
  });

  it("lets the athlete share what is in the case", () => {
    const trophy = code(TROPHY);
    // Whole-case share and per-item share both go through the app's share path.
    expect(trophy).toContain("shareWithInvite");
    expect(trophy).toContain("onShare={shareMedal}");
    expect(trophy).toContain("onShare={shareMarketItem}");
    expect(trophy).toContain("shareChallenge");

    const shelf = code("src/components/achievements/AchievementShelf.tsx");
    expect(shelf).toContain("onShare");
    // A locked medal must never grow a share button: it is not on the account.
    expect(shelf).toMatch(/onShare && earned/);
  });

  it("keeps the challenge catalogue on the challenges screen", () => {
    expect(code(ACHIEVEMENTS)).not.toContain("STANDING_CHALLENGES");
    expect(code(CHALLENGES)).toContain("StandingChallenges");
  });

  it("has no section switcher on either of them", () => {
    for (const page of [ACHIEVEMENTS, TROPHY]) {
      const source = code(page);
      // No in-page tab bar, and no hand-off to a sibling section.
      expect(source, `${page} still has a tab bar`).not.toContain('role="tablist"');
      expect(source, `${page} still links to another tab`).not.toMatch(/<Link[^>]*to="\/(badges|challenges)"/);
      expect(source, `${page} still links to another tab`).not.toMatch(/<a[^>]*href="\/(badges|challenges)"/);
    }
  });

  it("gives the hub no Badges tile, and points it at the case instead", () => {
    const perform = code(PERFORM);
    expect(perform).not.toContain('"/badges"');
    expect(perform).toContain('"/trophies"');
    expect(perform).toContain('"/achievements"');
    expect(perform).not.toContain('"/achievements?tab=');
  });

  it("still honours an old ?tab=badges link by showing the case", () => {
    // These links were shared before the split, so they must not land on the
    // wrong content — and the case is where that shelf lives now.
    expect(code(ACHIEVEMENTS)).toMatch(/Navigate to="\/trophies"/);
    expect(code(ACHIEVEMENTS)).toMatch(/Navigate to="\/challenges"/);
  });
});
