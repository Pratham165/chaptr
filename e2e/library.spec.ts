import { test, expect } from "@playwright/test";
import { db } from "../src/lib/db";
import bcrypt from "bcrypt";

test.describe("Library Feature End-to-End", () => {
  const testEmail = "test-reader@chaptr.app";
  const testPassword = "password123";
  let testUserId: string;

  test.beforeEach(async () => {
    // 1. Ensure test user exists with hashed credentials
    const hashedPassword = await bcrypt.hash(testPassword, 10);
    const user = await db.user.upsert({
      where: { email: testEmail },
      update: { password: hashedPassword },
      create: {
        email: testEmail,
        name: "Test Reader",
        password: hashedPassword,
      },
    });
    testUserId = user.id;

    // 2. Clear previous tracked reading progress for clean state
    await db.readingProgress.deleteMany({
      where: { userId: testUserId },
    });
  });

  test("log in, search MangaDex, add series, update progress, confirm UI reflects it", async ({
    page,
  }) => {
    // Mock MangaDex at the network level (Playwright route interception) for deterministic tests
    await page.route("**/api.mangadex.org/manga?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: "ok",
          response: "collection",
          data: [
            {
              id: "a7774250-d070-4945-84e7-f8ccaa041a46",
              type: "manga",
              attributes: {
                title: { en: "Chainsaw Man" },
              },
              relationships: [
                {
                  id: "cover-rel-1",
                  type: "cover_art",
                  attributes: {
                    fileName: "chainsaw-cover.jpg",
                  },
                },
              ],
            },
          ],
          limit: 15,
          offset: 0,
          total: 1,
        }),
      });
    });

    await page.route("**/api.mangadex.org/manga/*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: "ok",
          response: "entity",
          data: {
            id: "a7774250-d070-4945-84e7-f8ccaa041a46",
            type: "manga",
            attributes: {
              title: { en: "Chainsaw Man" },
            },
            relationships: [
              {
                id: "cover-rel-1",
                type: "cover_art",
                attributes: {
                  fileName: "chainsaw-cover.jpg",
                },
              },
            ],
          },
        }),
      });
    });

    await page.route("**/uploads.mangadex.org/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "image/jpeg",
        body: Buffer.from("fake-cover-image"),
      });
    });

    // 1. Test Login Page UI and authenticate through form
    await page.goto("/login");
    await expect(page.locator("h1")).toContainText(/Sign In/i);
    await page.fill("#email", testEmail);
    await page.fill("#password", testPassword);
    await page.click('button[type="submit"]');

    // 2. Confirm redirect to Library
    await expect(page).toHaveURL(/.*library/, { timeout: 15000 });
    await expect(page.locator("h1")).toContainText("Library");

    // 3. Search MangaDex for a series
    const searchInput = page.locator('input[placeholder*="Search manga"]');
    await expect(searchInput).toBeVisible();
    await searchInput.fill("Chainsaw Man");
    await page.click('button:has-text("Search")');

    // 4. Wait for results popover to appear
    await expect(page.locator("text=Results from MangaDex")).toBeVisible({
      timeout: 15000,
    });

    // 5. Click "Add to Library" on the first result
    const addButton = page.locator('button:has-text("Add to Library")').first();
    await expect(addButton).toBeVisible();
    await addButton.click();

    // Confirm button changes to "In Library" indicator
    await expect(
      page.locator("text=In Library").first()
    ).toBeVisible({ timeout: 15000 });

    // Close search popover
    await page.keyboard.press("Escape");

    // 6. Confirm series card appears in the library grid
    const seriesCard = page.locator(".group.relative.flex.flex-col").first();
    await expect(seriesCard).toBeVisible({ timeout: 15000 });

    // 7. Update reading progress: click "+" to increment chapter
    const incrementButton = seriesCard.locator('button[title="Next chapter"]');
    await expect(incrementButton).toBeVisible();
    await incrementButton.click();

    // 8. Confirm UI reflects the updated chapter (Ch. 1)
    await expect(seriesCard.locator("text=Ch. 1")).toBeVisible({
      timeout: 15000,
    });
  });
});
