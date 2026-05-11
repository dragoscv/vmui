import { test, expect } from "@playwright/test";

test.describe("Round 25-31 smoke", () => {
  test("schedules page renders", async ({ page }) => {
    await page.goto("/schedules");
    await expect(page.getByRole("heading", { name: /schedules/i })).toBeVisible();
    await expect(page.getByText(/new schedule/i)).toBeVisible();
  });

  test("compliance page renders", async ({ page }) => {
    await page.goto("/compliance");
    await expect(page.getByRole("heading", { name: /compliance/i })).toBeVisible();
    await expect(page.getByText(/findings/i).first()).toBeVisible();
  });

  test("onboarding page renders", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page.getByRole("heading", { name: /welcome to vmui/i })).toBeVisible();
    await expect(page.getByText(/master key/i).first()).toBeVisible();
  });

  test("recipes page renders", async ({ page }) => {
    await page.goto("/recipes");
    await expect(page.getByRole("heading", { name: /recipes/i })).toBeVisible();
  });

  test("tags page renders", async ({ page }) => {
    await page.goto("/tags");
    await expect(page.getByRole("heading", { name: /bulk tag/i }).first()).toBeVisible();
  });

  test("resource cleanup page renders", async ({ page }) => {
    await page.goto("/resources/cleanup");
    await expect(page.getByRole("heading", { name: /resource cleanup/i })).toBeVisible();
  });

  test("audit archive page renders", async ({ page }) => {
    await page.goto("/activity/archive");
    await expect(page.getByRole("heading", { name: /audit archives/i })).toBeVisible();
  });

  test("settings ssh-keys page renders", async ({ page }) => {
    await page.goto("/settings/ssh-keys");
    await expect(page.getByRole("heading", { name: /ssh keys/i }).first()).toBeVisible();
  });
});
