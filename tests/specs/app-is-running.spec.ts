import { test, expect } from "../fixtures/app.setup";

test.describe("Vaylo ad-making app", () => {
  test("the app boots and shows the home page", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/$/);

    await expect(page.getByRole("heading", { name: /Vaylo Sports Ads Studio/i })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("the app navigates to the ad studio", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.getByRole("link", { name: /Ad Studio/i }).click();
    await expect(page).toHaveURL(/\/studio$/);
    await expect(page.getByRole("heading", { name: /Ad Studio/i })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("the app navigates to the create-ad flow", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.getByRole("link", { name: /Create ad/i }).click();
    await expect(page).toHaveURL(/\/create$/);
    await expect(page.getByRole("heading", { name: /Create ad/i })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("the app shows the mobile menu on small screens", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /menu/i }).first().click();
    await expect(page.getByRole("link", { name: /Ad Studio/i }).first()).toBeVisible({
      timeout: 20_000,
    });
  });
});
