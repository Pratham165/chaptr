import { test, expect } from "@playwright/test";
import { db } from "../src/lib/db";
import bcrypt from "bcrypt";

test.describe("Dashboard and Chapter Updates End-to-End", () => {
  const runId = Date.now();
  const user1Email = `e2e-user1-unread-${runId}@example.test`;
  const user1Password = "password123";
  let user1Id: string;

  const user2Email = `e2e-user2-clean-${runId}@example.test`;
  const user2Password = "password123";
  let user2Id: string;

  const testMangadexId = "e2e-series-mangadex-uuid-999";

  test.beforeEach(async () => {
    const hashedPassword = await bcrypt.hash(user1Password, 10);

    // 1. Seed User 1
    const user1 = await db.user.upsert({
      where: { email: user1Email },
      update: { password: hashedPassword },
      create: {
        email: user1Email,
        name: "User One",
        password: hashedPassword,
      },
    });
    user1Id = user1.id;

    // 2. Seed User 2
    const user2 = await db.user.upsert({
      where: { email: user2Email },
      update: { password: hashedPassword },
      create: {
        email: user2Email,
        name: "User Two",
        password: hashedPassword,
      },
    });
    user2Id = user2.id;

    // 3. Clear progress for clean state
    await db.readingProgress.deleteMany({
      where: {
        userId: { in: [user1Id, user2Id] },
      },
    });

    // 4. Seed Series with latestChapter: 42
    const series = await db.series.upsert({
      where: { mangadexId: testMangadexId },
      update: {
        title: "E2E Chainsaw Hero",
        latestChapter: 42,
        coverUrl: "https://uploads.mangadex.org/covers/e2e/cover.jpg",
      },
      create: {
        mangadexId: testMangadexId,
        title: "E2E Chainsaw Hero",
        latestChapter: 42,
        coverUrl: "https://uploads.mangadex.org/covers/e2e/cover.jpg",
      },
    });

    // 5. Seed ReadingProgress for User 1: hasUpdate = true (lastReadChapter: 40)
    await db.readingProgress.create({
      data: {
        userId: user1Id,
        seriesId: series.id,
        lastReadChapter: 40,
        status: "READING",
        hasUpdate: true,
      },
    });

    // 6. Seed ReadingProgress for User 2: hasUpdate = false (lastReadChapter: 42)
    await db.readingProgress.create({
      data: {
        userId: user2Id,
        seriesId: series.id,
        lastReadChapter: 42,
        status: "READING",
        hasUpdate: false,
      },
    });
  });

  test("dashboard & nav indicator show unread update, mark caught up clears it, and user 2 is isolated", async ({
    page,
  }) => {
    // Mock cover image request to prevent external network failure
    await page.route("**/uploads.mangadex.org/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "image/jpeg",
        body: Buffer.from("fake-cover-image"),
      });
    });

    // 1. User 1 logs in
    await page.goto("/login");
    await page.fill("#email", user1Email);
    await page.fill("#password", user1Password);
    await page.click('button[type="submit"]');

    // 2. Wait for navigation after authentication
    await expect(page).toHaveURL(/.*library/, { timeout: 15000 });

    // 3. Confirm nav indicator shows count 1
    const navIndicator = page.locator('[data-testid="nav-unread-indicator"]');
    await expect(navIndicator).toBeVisible({ timeout: 10000 });
    await expect(navIndicator).toContainText("1");

    // 4. Navigate to /dashboard
    await page.click('a[href="/dashboard"]');
    await expect(page).toHaveURL(/.*dashboard/, { timeout: 10000 });

    // 5. Verify Dashboard header and unread card
    await expect(page.locator("h1")).toContainText("Dashboard");
    await expect(page.locator("text=1 series with new chapters")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator("text=E2E Chainsaw Hero")).toBeVisible();
    await expect(page.locator("text=Ch. 40")).toBeVisible();
    await expect(page.locator("text=Ch. 42")).toBeVisible();

    // 6. Click "Mark caught up"
    const markCaughtUpBtn = page.locator('button:has-text("Mark caught up")');
    await expect(markCaughtUpBtn).toBeVisible();
    await markCaughtUpBtn.click();

    // 7. Verify unread update is cleared and dashboard reflects "All caught up"
    await expect(page.locator("text=All caught up")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("text=0 series with new chapters")).toBeVisible();

    // 8. Confirm nav indicator is cleared
    await expect(navIndicator).not.toBeVisible();

    // 9. Sign out
    await page.click('button:has-text("Sign out")');
    await expect(page).toHaveURL(/.*login/, { timeout: 15000 });

    // 10. Log in as User 2
    await page.fill("#email", user2Email);
    await page.fill("#password", user2Password);
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*library/, { timeout: 15000 });

    // 11. Confirm User 2 cannot see User 1's flags
    await expect(navIndicator).not.toBeVisible();

    await page.goto("/dashboard");
    await expect(page.locator("h1")).toContainText("Dashboard");
    await expect(page.locator("text=0 series with new chapters")).toBeVisible();
    await expect(page.locator("text=All caught up")).toBeVisible();
    await expect(page.locator("text=E2E Chainsaw Hero")).not.toBeVisible();
  });
});
