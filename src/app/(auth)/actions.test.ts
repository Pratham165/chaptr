import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerAction, loginAction } from "./actions";
import { db } from "@/lib/db";
import { signIn, RateLimitError, ServiceUnavailableError } from "@/lib/auth";
import {
  authRegisterEmailRatelimit,
  authRegisterIpRatelimit,
  resetMissingIpWarn,
} from "@/lib/redis";
import { CredentialsSignin } from "next-auth";

// Mock next/headers
vi.mock("next/headers", () => ({
  headers: vi.fn(() => new Headers({ "x-real-ip": "198.51.100.1" })),
}));

// Mock bcrypt
vi.mock("bcrypt", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("hashed_password_123"),
    compare: vi.fn(),
  },
}));

// Mock db
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// Mock auth
vi.mock("@/lib/auth", async () => {
  const { CredentialsSignin } = await import("@auth/core/errors");
  class MockRateLimitError extends CredentialsSignin {
    code = "rate_limit_exceeded";
  }
  class MockServiceUnavailableError extends CredentialsSignin {
    code = "service_unavailable";
    message = "Service temporarily unavailable. Please try again later.";
  }
  return {
    signIn: vi.fn(),
    RateLimitError: MockRateLimitError,
    ServiceUnavailableError: MockServiceUnavailableError,
    BCRYPT_ROUNDS: 12,
  };
});

// Mock redis
vi.mock("@/lib/redis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/redis")>();
  return {
    ...actual,
    authRegisterEmailRatelimit: {
      limit: vi.fn(),
    },
    authRegisterIpRatelimit: {
      limit: vi.fn(),
    },
    getClientIp: vi.fn().mockReturnValue("198.51.100.1"),
  };
});

describe("Auth Server Actions ((auth)/actions.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authRegisterEmailRatelimit.limit).mockResolvedValue({
      success: true,
      limit: 5,
      remaining: 4,
      reset: Date.now() + 60000,
    });
    vi.mocked(authRegisterIpRatelimit.limit).mockResolvedValue({
      success: true,
      limit: 20,
      remaining: 19,
      reset: Date.now() + 60000,
    });
    resetMissingIpWarn();
  });

  describe("registerAction", () => {
    it("logs server-side error and returns generic message on non-P2002 database error", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(db.user.create).mockRejectedValueOnce(
        new Error("Database connection dropped")
      );

      const form = new FormData();
      form.set("name", "User DB Error");
      form.set("email", "user@example.com");
      form.set("password", "validPass123");
      form.set("confirmPassword", "validPass123");

      const res = await registerAction(form);
      expect(res).toEqual({
        success: false,
        error: "Something went wrong. Please try again.",
      });
      expect(errSpy).toHaveBeenCalledWith(
        "User registration failed:",
        expect.any(Error)
      );
      errSpy.mockRestore();
    });
    it("creates user on first registration and catches Prisma P2002 duplicate on second registration", async () => {
      // 1. First registration with A@X.com
      vi.mocked(db.user.create).mockResolvedValueOnce({
        id: "u-1",
        email: "a@x.com",
        name: "User One",
        password: "hashed_password_123",
      } as never);

      const form1 = new FormData();
      form1.set("name", "User One");
      form1.set("email", "A@X.com");
      form1.set("password", "validPass123");
      form1.set("confirmPassword", "validPass123");

      const res1 = await registerAction(form1);
      expect(res1).toEqual({ success: true });

      // Verify db.user.create received lowercased email
      expect(db.user.create).toHaveBeenCalledWith({
        data: {
          name: "User One",
          email: "a@x.com",
          password: "hashed_password_123",
        },
      });

      // 2. Second registration with a@x.com throws Prisma P2002 unique constraint error
      const p2002Error = new Error("Unique constraint failed on the fields: (`email`)");
      (p2002Error as unknown as { code: string }).code = "P2002";
      vi.mocked(db.user.create).mockRejectedValueOnce(p2002Error);

      const form2 = new FormData();
      form2.set("name", "User Two");
      form2.set("email", "a@x.com");
      form2.set("password", "validPass123");
      form2.set("confirmPassword", "validPass123");

      const res2 = await registerAction(form2);
      expect(res2).toEqual({
        success: false,
        error: "An account with this email already exists",
      });
    });

    it("fails closed with temporarily unavailable error when rate limiter throws", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(authRegisterEmailRatelimit.limit).mockRejectedValueOnce(
        new Error("Upstash Redis connection timeout")
      );

      const form = new FormData();
      form.set("name", "User");
      form.set("email", "user@example.com");
      form.set("password", "validPass123");
      form.set("confirmPassword", "validPass123");

      const res = await registerAction(form);
      expect(res).toEqual({
        success: false,
        error: "Service temporarily unavailable. Please try again later.",
      });

      expect(db.user.create).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it("skips IP limiter and logs console.warn when client IP cannot be determined", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { getClientIp } = await import("@/lib/redis");
      vi.mocked(getClientIp).mockReturnValueOnce(null);

      vi.mocked(db.user.create).mockResolvedValueOnce({
        id: "u-1",
        email: "user@example.com",
        name: "User",
        password: "hashed_password_123",
      } as never);

      const form = new FormData();
      form.set("name", "User");
      form.set("email", "user@example.com");
      form.set("password", "validPass123");
      form.set("confirmPassword", "validPass123");

      const res = await registerAction(form);
      expect(res).toEqual({ success: true });

      // Email limit was enforced
      expect(authRegisterEmailRatelimit.limit).toHaveBeenCalledWith("user@example.com");
      // IP limit was skipped
      expect(authRegisterIpRatelimit.limit).not.toHaveBeenCalled();
      // Warned once
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Client IP could not be determined; skipping IP rate limit/i)
      );

      warnSpy.mockRestore();
    });

    it("rejects password shorter than 10 characters", async () => {
      const form = new FormData();
      form.set("name", "User");
      form.set("email", "user@example.com");
      form.set("password", "short");
      form.set("confirmPassword", "short");

      const res = await registerAction(form);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Password must be at least 10 characters long/i);
      expect(db.user.create).not.toHaveBeenCalled();
    });

    it("rejects password longer than 72 bytes", async () => {
      const form = new FormData();
      form.set("name", "User");
      form.set("email", "user@example.com");
      form.set("password", "a".repeat(73));
      form.set("confirmPassword", "a".repeat(73));

      const res = await registerAction(form);
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Password cannot exceed 72 bytes/i);
      expect(db.user.create).not.toHaveBeenCalled();
    });

    it("rate limits registration by normalized email (5 attempts / 15 min)", async () => {
      vi.mocked(authRegisterEmailRatelimit.limit).mockResolvedValueOnce({
        success: false,
        limit: 5,
        remaining: 0,
        reset: Date.now() + 60000,
      });

      const form = new FormData();
      form.set("name", "Spammer");
      form.set("email", "   Spam@Example.COM   ");
      form.set("password", "password123");
      form.set("confirmPassword", "password123");

      const res = await registerAction(form);
      expect(res).toEqual({
        success: false,
        error: "Too many registration attempts. Please try again later.",
      });

      // Keyed by normalized email
      expect(authRegisterEmailRatelimit.limit).toHaveBeenCalledWith("spam@example.com");
      expect(db.user.create).not.toHaveBeenCalled();
    });

    it("rate limits registration by client IP (20 attempts / 15 min)", async () => {
      vi.mocked(authRegisterIpRatelimit.limit).mockResolvedValueOnce({
        success: false,
        limit: 20,
        remaining: 0,
        reset: Date.now() + 60000,
      });

      const form = new FormData();
      form.set("name", "Spammer");
      form.set("email", "newuser@example.com");
      form.set("password", "password123");
      form.set("confirmPassword", "password123");

      const res = await registerAction(form);
      expect(res).toEqual({
        success: false,
        error: "Too many registration attempts. Please try again later.",
      });

      expect(db.user.create).not.toHaveBeenCalled();
    });
  });

  describe("loginAction", () => {
    it("accepts an 8-character password and attempts signIn", async () => {
      vi.mocked(signIn).mockResolvedValueOnce(undefined as never);

      const form = new FormData();
      form.set("email", "user@example.com");
      form.set("password", "pass1234"); // 8 characters

      const res = await loginAction(form);
      expect(res).toEqual({ success: true });
      expect(signIn).toHaveBeenCalledWith("credentials", {
        email: "user@example.com",
        password: "pass1234",
        redirectTo: "/library",
      });
    });

    it("returns generic error for failed login (wrong password)", async () => {
      const err = new CredentialsSignin();
      err.type = "CredentialsSignin";
      vi.mocked(signIn).mockRejectedValueOnce(err);

      const form = new FormData();
      form.set("email", "user@example.com");
      form.set("password", "wrongpassword123");

      const res = await loginAction(form);
      expect(res).toEqual({
        success: false,
        error: "Invalid email or password",
      });
    });

    it("returns generic error for invalid login input format (empty password)", async () => {
      const form = new FormData();
      form.set("email", "not-an-email");
      form.set("password", "");

      const res = await loginAction(form);
      expect(res).toEqual({
        success: false,
        error: "Invalid email or password",
      });
      expect(signIn).not.toHaveBeenCalled();
    });

    it("returns rate limit error when rate limit is exceeded during login", async () => {
      const err = new CredentialsSignin();
      err.type = "CredentialsSignin";
      (err as unknown as { code: string }).code = "rate_limit_exceeded";
      vi.mocked(signIn).mockRejectedValueOnce(err);

      const form = new FormData();
      form.set("email", "user@example.com");
      form.set("password", "validpassword123");

      const res = await loginAction(form);
      expect(res).toEqual({
        success: false,
        error: "Too many login attempts. Please try again later.",
      });
    });

    it("returns service unavailable error when rate limiter or auth service is down", async () => {
      const err = new CredentialsSignin();
      err.type = "CredentialsSignin";
      (err as unknown as { code: string }).code = "service_unavailable";
      vi.mocked(signIn).mockRejectedValueOnce(err);

      const form = new FormData();
      form.set("email", "user@example.com");
      form.set("password", "validpassword123");

      const res = await loginAction(form);
      expect(res).toEqual({
        success: false,
        error: "Service temporarily unavailable. Please try again later.",
      });
    });

    it("maps direct RateLimitError instance to too many attempts message", async () => {
      vi.mocked(signIn).mockRejectedValueOnce(new RateLimitError());

      const form = new FormData();
      form.set("email", "user@example.com");
      form.set("password", "validpassword123");

      const res = await loginAction(form);
      expect(res).toEqual({
        success: false,
        error: "Too many login attempts. Please try again later.",
      });
    });

    it("maps direct ServiceUnavailableError instance to service temporarily unavailable message", async () => {
      vi.mocked(signIn).mockRejectedValueOnce(new ServiceUnavailableError());

      const form = new FormData();
      form.set("email", "user@example.com");
      form.set("password", "validpassword123");

      const res = await loginAction(form);
      expect(res).toEqual({
        success: false,
        error: "Service temporarily unavailable. Please try again later.",
      });
    });

    it("maps wrapped RateLimitError inside cause.err to too many attempts message", async () => {
      const authErr = new CredentialsSignin();
      authErr.cause = { err: new RateLimitError() };
      vi.mocked(signIn).mockRejectedValueOnce(authErr);

      const form = new FormData();
      form.set("email", "user@example.com");
      form.set("password", "validpassword123");

      const res = await loginAction(form);
      expect(res).toEqual({
        success: false,
        error: "Too many login attempts. Please try again later.",
      });
    });

    it("maps wrapped ServiceUnavailableError inside cause.err to service temporarily unavailable message", async () => {
      const authErr = new CredentialsSignin();
      authErr.cause = { err: new ServiceUnavailableError() };
      vi.mocked(signIn).mockRejectedValueOnce(authErr);

      const form = new FormData();
      form.set("email", "user@example.com");
      form.set("password", "validpassword123");

      const res = await loginAction(form);
      expect(res).toEqual({
        success: false,
        error: "Service temporarily unavailable. Please try again later.",
      });
    });

    it("rethrows non-AuthError exceptions such as Next.js redirect", async () => {
      const redirectError = new Error("NEXT_REDIRECT");
      vi.mocked(signIn).mockRejectedValueOnce(redirectError);

      const form = new FormData();
      form.set("email", "user@example.com");
      form.set("password", "validpassword123");

      await expect(loginAction(form)).rejects.toThrow("NEXT_REDIRECT");
    });

    it("returns success: true when signIn succeeds", async () => {
      vi.mocked(signIn).mockResolvedValueOnce(undefined as never);

      const form = new FormData();
      form.set("email", "  Reader@Chaptr.App  ");
      form.set("password", "validpassword123");

      const res = await loginAction(form);
      expect(res).toEqual({ success: true });
      expect(signIn).toHaveBeenCalledWith("credentials", {
        email: "reader@chaptr.app",
        password: "validpassword123",
        redirectTo: "/library",
      });
    });
  });
});
