import { test, expect } from "@playwright/test";

test.describe("smoke", () => {
  test("home page renders", async ({ page }) => {
    await page.goto("/");
    // Sidebar items must exist regardless of state.
    await expect(page.getByRole("link", { name: /instances/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /resources/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /accounts/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /settings/i })).toBeVisible();
  });

  test("accounts page", async ({ page }) => {
    await page.goto("/accounts");
    await expect(page.getByRole("heading", { name: /cloud accounts/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /add account/i })).toBeVisible();
  });

  test("new-account wizard exposes all five providers", async ({ page }) => {
    await page.goto("/accounts/new");
    for (const tab of ["AWS", "Azure", "GCP", "Scaleway", "Local"]) {
      await expect(page.getByRole("tab", { name: new RegExp(tab, "i") }).first()).toBeVisible();
    }
  });

  test("resources page", async ({ page }) => {
    await page.goto("/resources");
    await expect(page.getByRole("heading", { name: /resources/i }).first()).toBeVisible();
  });

  test("activity page filters render", async ({ page }) => {
    await page.goto("/activity");
    await expect(page.getByPlaceholder(/search actions/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /CSV/i })).toBeVisible();
  });

  test("costs page shows hourly burn card", async ({ page }) => {
    await page.goto("/costs");
    await expect(page.getByRole("heading", { name: /cost overview/i })).toBeVisible();
    await expect(page.getByText(/hourly burn/i)).toBeVisible();
    await expect(page.getByText(/projected month/i)).toBeVisible();
  });

  test("settings page", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /settings/i }).first()).toBeVisible();
  });
});
