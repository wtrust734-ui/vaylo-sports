// ============================================================================
// THE TROPHY ROOM IS FOUR SCREENS
// ----------------------------------------------------------------------------
// Achievements (the catalogue), the Trophy Room (what is actually on the
// account), Badges (bought) and Challenges (joined). Four routes, four files.
//
// Asserted on the source rather than on a render, because the thing being
// prevented is structural: a section creeping back into another section's page.
// The failure this guards against is not a visual one — it is Achievements
// becoming a door to the things you buy and the challenges you join, which is
// how the two got confused in the first place.
//
// A render test would need a signed-in athlete, sixteen Supabase reads and a
// router; what actually has to stay true is which file owns which shelf, and
// that is legible in the source.
// ============================================================================

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

/** Comments explain the split, so they must not be what a test reads. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const ACHIEVEMENTS = "src/pages/Achievements.tsx";
const BADGES = "src/pages/Badges.tsx";
const CHALLENGES = "src/pages/Challenges.tsx";
const TROPHY = "src/pages/TrophyRoom.tsx";
const APP = "src/App.tsx";
const PERFORM = "src/pages/Perform.tsx";

describe("the Trophy Room's four screens", () => {
  it("routes each one to its own screen", () => {
    const app = code(APP);
    expect(app).toContain('path="/achievements"');
    expect(app).toContain('path="/trophies"');
    expect(app).toContain('path="/badges"');
    expect(app).toContain('path="/challenges"');
    // Each route is its own page component, not one page with a parameter.
    expect(app).toMatch(/import\("\.\/pages\/Badges"\)/);
    expect(app).toMatch(/import\("\.\/pages\/Achievements"\)/);
    expect(app).toMatch(/import\("\.\/pages\/TrophyRoom"\)/);
  });

  it("keeps the catalogue and the trophy case as separate screens", () => {
    // Achievements is the full list (locked rows included); the Trophy Room is
    // only what the account holds, medals and badges together.
    const achievements = code(ACHIEVEMENTS);
    expect(achievements).toContain("achievementShelf");
    // The catalogue filters across the whole shelf, so it can show locked rows.
    expect(achievements).toContain('"Locked"');

    const trophy = code(TROPHY);
    expect(trophy).toContain("earnedIds.has");
  });

  it("keeps badges off the achievements screen and achievements off the badge screen", () => {
    const achievements = code(ACHIEVEMENTS);
    // The badge shelf is a different shelf. Reaching for it here is the exact
    // regression this test exists for.
    expect(achievements).not.toContain("badgeShelf");
    expect(achievements).not.toContain("BADGE_IDS");
    expect(achievements).toContain("achievementShelf");

    const badges = code(BADGES);
    expect(badges).not.toContain("achievementShelf");
    expect(badges).toContain("badgeShelf");
  });

  it("keeps the challenge catalogue on the challenges screen", () => {
    // The standing challenges were a tab of Achievements. They are challenges,
    // so the Challenges screen owns them.
    expect(code(ACHIEVEMENTS)).not.toContain("STANDING_CHALLENGES");
    expect(code(CHALLENGES)).toContain("StandingChallenges");
  });

  it("has no section switcher on any of them", () => {
    for (const page of [ACHIEVEMENTS, BADGES, TROPHY]) {
      const source = code(page);
      // No in-page tab bar, and no hand-off to a sibling section: each screen
      // links to nothing but itself.
      expect(source, `${page} still has a tab bar`).not.toContain('role="tablist"');
      // A link or an anchor into a sibling section is a hand-off; the legacy
      // `<Navigate>` redirects are asserted separately, and are not links the
      // athlete can see or read on the page.
      expect(source, `${page} still links to another tab`).not.toMatch(/<Link[^>]*to="\/(badges|challenges)"/);
      expect(source, `${page} still links to another tab`).not.toMatch(/<a[^>]*href="\/(badges|challenges)"/);
    }
  });

  it("points the hub's Badges tile at the Badges screen", () => {
    // The tile used to deep-link `/achievements?tab=badges`. A tab that opens
    // another tab's page is the thing being removed.
    const perform = code(PERFORM);
    expect(perform).toContain('path: "/badges"');
    expect(perform).not.toContain('"/achievements?tab=');
  });

  it("still honours an old ?tab= link by leaving for the right screen", () => {
    // These links were shared before the split, so they must not land on the
    // wrong content — a redirect is not the same screen.
    const achievements = code(ACHIEVEMENTS);
    expect(achievements).toMatch(/Navigate to="\/badges"/);
    expect(achievements).toMatch(/Navigate to="\/challenges"/);
  });
});
