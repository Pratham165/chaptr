import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "./route";
import { runChapterCheck } from "@/lib/chapters";
import { NextRequest } from "next/server";

// Mock runChapterCheck
vi.mock("@/lib/chapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chapters")>();
  return {
    ...actual,
    runChapterCheck: vi.fn(),
  };
});

describe("Cron Route Handler (/api/cron/check-chapters)", () => {
  const validSecret32 = "a-very-secure-secret-that-is-at-least-32-chars-long";
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, CRON_SECRET: validSecret32 };
    vi.mocked(runChapterCheck).mockResolvedValue({
      checked: 10,
      updated: 2,
      failed: 0,
      skippedLocked: false,
      stoppedEarly: false,
    });
  });

  describe("Fail Closed Security", () => {
    it("returns 500 when CRON_SECRET is undefined", async () => {
      delete process.env.CRON_SECRET;

      const req = new NextRequest("http://localhost/api/cron/check-chapters", {
        method: "GET",
        headers: {
          authorization: `Bearer ${validSecret32}`,
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(500);
      expect(runChapterCheck).not.toHaveBeenCalled();
    });

    it("returns 500 when CRON_SECRET is shorter than 32 characters", async () => {
      process.env.CRON_SECRET = "too-short-secret-only-24";

      const req = new NextRequest("http://localhost/api/cron/check-chapters", {
        method: "POST",
        headers: {
          authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(500);
      expect(runChapterCheck).not.toHaveBeenCalled();
    });
  });

  describe("Authorization Header Verification", () => {
    it("returns bare 401 when Authorization header is missing", async () => {
      const req = new NextRequest("http://localhost/api/cron/check-chapters", {
        method: "GET",
      });

      const res = await GET(req);
      expect(res.status).toBe(401);
      expect(runChapterCheck).not.toHaveBeenCalled();
    });

    it("returns bare 401 when Authorization header does not use Bearer scheme", async () => {
      const req = new NextRequest("http://localhost/api/cron/check-chapters", {
        method: "GET",
        headers: {
          authorization: `Basic ${validSecret32}`,
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(401);
      expect(runChapterCheck).not.toHaveBeenCalled();
    });

    it("returns bare 401 when Bearer token is incorrect", async () => {
      const req = new NextRequest("http://localhost/api/cron/check-chapters", {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-token-that-does-not-match-at-all-32-chars",
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(401);
      expect(runChapterCheck).not.toHaveBeenCalled();
    });

    it("a user session cookie alone does NOT authorize the route (returns 401)", async () => {
      const req = new NextRequest("http://localhost/api/cron/check-chapters", {
        method: "GET",
        headers: {
          cookie: "next-auth.session-token=valid-user-session-token",
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(401);
      expect(runChapterCheck).not.toHaveBeenCalled();
    });
  });

  describe("Successful Execution", () => {
    it("returns 200 with summary JSON for valid GET request (Vercel cron format)", async () => {
      const req = new NextRequest("http://localhost/api/cron/check-chapters", {
        method: "GET",
        headers: {
          authorization: `Bearer ${validSecret32}`,
        },
      });

      const res = await GET(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json).toEqual({
        checked: 10,
        updated: 2,
        failed: 0,
        skippedLocked: false,
        stoppedEarly: false,
      });

      expect(runChapterCheck).toHaveBeenCalledWith({
        batchSize: 30,
        timeBudgetMs: 7000,
      });
    });

    it("returns 200 with summary JSON for valid POST request (GitHub Actions format)", async () => {
      const req = new NextRequest("http://localhost/api/cron/check-chapters", {
        method: "POST",
        headers: {
          authorization: `Bearer ${validSecret32}`,
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.checked).toBe(10);
      expect(runChapterCheck).toHaveBeenCalled();
    });

    it("respects CRON_BATCH_SIZE and clamps CRON_TIME_BUDGET_MS to 8000", async () => {
      process.env.CRON_BATCH_SIZE = "50";
      process.env.CRON_TIME_BUDGET_MS = "12000";

      const req = new NextRequest("http://localhost/api/cron/check-chapters", {
        method: "POST",
        headers: {
          authorization: `Bearer ${validSecret32}`,
        },
      });

      await POST(req);

      expect(runChapterCheck).toHaveBeenCalledWith({
        batchSize: 50,
        timeBudgetMs: 8000,
      });
    });
  });

  describe("Error Handling & Server-Side Exception Logging", () => {
    it("returns a bare 500 with no body and logs error with console.error when runChapterCheck throws", async () => {
      vi.mocked(runChapterCheck).mockRejectedValue(new Error("Database disconnected"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const req = new NextRequest("http://localhost/api/cron/check-chapters", {
        method: "POST",
        headers: {
          authorization: `Bearer ${validSecret32}`,
        },
      });

      const res = await POST(req);
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).toBe(""); // Bare 500 with no body
      expect(errorSpy).toHaveBeenCalledWith(
        "Chapter check cron job execution failed:",
        expect.any(Error)
      );
    });
  });
});

