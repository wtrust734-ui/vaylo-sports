import { test as base, expect as baseExpect } from "@playwright/test";

export const test = base;
export const expect = baseExpect;

test.describe("Vaylo web app", () => {
  test("app is reachable and shows the shell", async ({ page }) => {
    const appUrl = process.env.APP_URL || "http://localhost:5173";

    await page.goto(appUrl, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/$/);

    await expect(page.getByRole("heading", { name: /Vaylo Sports/i })).toBeVisible({
      timeout: 20_000,
    });
  });
});
