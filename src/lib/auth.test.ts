import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcrypt";
import {
  customPrismaAdapter,
  authorize,
  RateLimitError,
  ServiceUnavailableError,
  BCRYPT_ROUNDS,
  DUMMY_HASH,
} from "./auth";
import {
  authLoginEmailRatelimit,
  authLoginIpRatelimit,
  getClientIp,
  resetMissingIpWarn,
} from "@/lib/redis";
import db from "@/lib/db";

// Mock bcrypt but preserve actual functions (including getRounds and hashSync)
vi.mock("bcrypt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bcrypt")>();
  return {
    ...actual,
    default: {
      ...actual,
      compare: vi.fn(),
      hash: vi.fn(),
    },
  };
});

// Mock db module
vi.mock("@/lib/db", () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
  db: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock redis module
vi.mock("@/lib/redis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/redis")>();
  return {
    ...actual,
    authLoginEmailRatelimit: {
      limit: vi.fn(),
    },
    authLoginIpRatelimit: {
      limit: vi.fn(),
    },
  };
});

describe("Auth Module & Custom Adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authLoginEmailRatelimit.limit).mockResolvedValue({
      success: true,
      limit: 5,
      remaining: 4,
      reset: Date.now() + 60000,
    });
    vi.mocked(authLoginIpRatelimit.limit).mockResolvedValue({
      success: true,
      limit: 20,
      remaining: 19,
      reset: Date.now() + 60000,
    });
    resetMissingIpWarn();
  });

  describe("BCRYPT_ROUNDS and DUMMY_HASH", () => {
    it("ensures BCRYPT_ROUNDS is 12 and DUMMY_HASH was generated at cost 12", () => {
      expect(BCRYPT_ROUNDS).toBe(12);
      expect(bcrypt.getRounds(DUMMY_HASH)).toBe(12);
      expect(bcrypt.getRounds(DUMMY_HASH)).toBe(BCRYPT_ROUNDS);
    });
  });

  describe("customPrismaAdapter (Google sign-in & OAuth coverage)", () => {
    it("lowercases email on createUser", async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        id: "user-1",
        name: "Google User",
        email: "googleuser@example.com",
      });

      const mockPrisma = {
        user: {
          create: mockCreate,
          findUnique: vi.fn(),
          update: vi.fn(),
        },
      } as unknown as Parameters<typeof customPrismaAdapter>[0];

      const adapter = customPrismaAdapter(mockPrisma);
      await adapter.createUser!({
        id: "temp-id",
        name: "Google User",
        email: "GoogleUser@EXAMPLE.com",
        emailVerified: null,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: "googleuser@example.com",
            name: "Google User",
          }),
        })
      );
    });

    it("lowercases email on getUserByEmail lookup", async () => {
      const mockFindUnique = vi.fn().mockResolvedValue({
        id: "user-1",
        email: "oauth@example.com",
      });

      const mockPrisma = {
        user: {
          findUnique: mockFindUnique,
        },
      } as unknown as Parameters<typeof customPrismaAdapter>[0];

      const adapter = customPrismaAdapter(mockPrisma);
      await adapter.getUserByEmail!("  OAuth@Example.COM  ");

      expect(mockFindUnique).toHaveBeenCalledWith({
        where: { email: "oauth@example.com" },
      });
    });

    it("lowercases email on updateUser when email is provided", async () => {
      const mockUpdate = vi.fn().mockResolvedValue({
        id: "user-1",
        email: "updated@example.com",
      });

      const mockPrisma = {
        user: {
          update: mockUpdate,
        },
      } as unknown as Parameters<typeof customPrismaAdapter>[0];

      const adapter = customPrismaAdapter(mockPrisma);
      await adapter.updateUser!({
        id: "user-1",
        email: "Updated@Example.COM",
      });

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "user-1" },
          data: expect.objectContaining({
            email: "updated@example.com",
          }),
        })
      );
    });
  });

  describe("getClientIp helper", () => {
    it("reads x-vercel-forwarded-for first", () => {
      const req = new Request("https://example.test", {
        headers: {
          "x-vercel-forwarded-for": "203.0.113.195, 70.41.3.18",
          "x-real-ip": "198.51.100.2",
          "x-forwarded-for": "10.0.0.1",
        },
      });
      expect(getClientIp(req)).toBe("203.0.113.195");
    });

    it("reads x-real-ip when x-vercel-forwarded-for is absent", () => {
      const req = new Request("https://example.test", {
        headers: {
          "x-real-ip": "198.51.100.2",
          "x-forwarded-for": "10.0.0.1",
        },
      });
      expect(getClientIp(req)).toBe("198.51.100.2");
    });

    it("ignores x-forwarded-for by default so a spoofed x-forwarded-for does not change the key", () => {
      const originalTrust = process.env.TRUST_XFF;
      delete process.env.TRUST_XFF;

      const req = new Request("https://example.test", {
        headers: {
          "x-forwarded-for": "10.0.0.99",
        },
      });

      expect(getClientIp(req)).toBeNull();

      if (originalTrust !== undefined) {
        process.env.TRUST_XFF = originalTrust;
      }
    });

    it("reads x-forwarded-for only when TRUST_XFF=true", () => {
      const originalTrust = process.env.TRUST_XFF;
      process.env.TRUST_XFF = "true";

      const req = new Request("https://example.test", {
        headers: {
          "x-forwarded-for": "10.0.0.99, 10.0.0.100",
        },
      });

      expect(getClientIp(req)).toBe("10.0.0.99");

      if (originalTrust !== undefined) {
        process.env.TRUST_XFF = originalTrust;
      } else {
        delete process.env.TRUST_XFF;
      }
    });

    it("never reads cf-connecting-ip", () => {
      const req = new Request("https://example.test", {
        headers: {
          "cf-connecting-ip": "192.0.2.1",
        },
      });
      expect(getClientIp(req)).toBeNull();
    });

    it("returns null if headers are absent (no shared 127.0.0.1 fallback)", () => {
      expect(getClientIp(undefined)).toBeNull();
      expect(getClientIp(null)).toBeNull();
      expect(getClientIp(new Request("https://example.test"))).toBeNull();
    });
  });

  describe("Credentials Provider authorize()", () => {
    it("normalizes email and successfully logs in with any casing", async () => {
      const mockUser = {
        id: "u-123",
        name: "Test Reader",
        email: "reader@chaptr.app",
        password: "hashed-password",
        image: null,
      };

      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as never);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      const request = new Request("https://chaptr.app/api/auth/callback/credentials", {
        headers: { "x-vercel-forwarded-for": "10.0.0.1" },
      });

      // Attempt login with uppercase and spaces
      const result = await authorize(
        { email: "   Reader@CHAPTR.APP   ", password: "password123" },
        request
      );

      // Verify rate limiter was called with normalized email and client IP
      expect(authLoginEmailRatelimit.limit).toHaveBeenCalledWith("reader@chaptr.app");
      expect(authLoginIpRatelimit.limit).toHaveBeenCalledWith("10.0.0.1");

      // Verify db lookup used normalized email
      expect(db.user.findUnique).toHaveBeenCalledWith({
        where: { email: "reader@chaptr.app" },
      });

      // Verify bcrypt compared against user password
      expect(bcrypt.compare).toHaveBeenCalledWith("password123", "hashed-password");

      expect(result).toEqual({
        id: "u-123",
        name: "Test Reader",
        email: "reader@chaptr.app",
        image: null,
      });
    });

    it("skips IP limiter and warns once when client IP cannot be determined", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const mockUser = {
        id: "u-123",
        name: "Test Reader",
        email: "reader@chaptr.app",
        password: "hashed-password",
        image: null,
      };

      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as never);
      vi.mocked(bcrypt.compare).mockResolvedValue(true as never);

      // No headers => getClientIp returns null
      const request = new Request("https://chaptr.app/api/auth/callback/credentials");

      const result = await authorize(
        { email: "reader@chaptr.app", password: "password123" },
        request
      );

      expect(authLoginEmailRatelimit.limit).toHaveBeenCalledWith("reader@chaptr.app");
      expect(authLoginIpRatelimit.limit).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Client IP could not be determined; skipping IP rate limit/i)
      );

      expect(result).toEqual({
        id: "u-123",
        name: "Test Reader",
        email: "reader@chaptr.app",
        image: null,
      });

      // Second authorize call with missing IP in same process must NOT warn again
      await authorize(
        { email: "reader@chaptr.app", password: "password123" },
        request
      );
      expect(warnSpy).toHaveBeenCalledTimes(1);

      warnSpy.mockRestore();
    });

    it("throws RateLimitError when email rate limit is exceeded", async () => {
      vi.mocked(authLoginEmailRatelimit.limit).mockResolvedValueOnce({
        success: false,
        limit: 5,
        remaining: 0,
        reset: Date.now() + 60000,
      });

      const request = new Request("https://chaptr.app/api/auth/callback/credentials", {
        headers: { "x-vercel-forwarded-for": "10.0.0.1" },
      });

      await expect(
        authorize(
          { email: "user@example.com", password: "password123" },
          request
        )
      ).rejects.toThrow(RateLimitError);

      // DB and bcrypt must NOT be called when rate limited
      expect(db.user.findUnique).not.toHaveBeenCalled();
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it("throws RateLimitError when IP rate limit is exceeded", async () => {
      vi.mocked(authLoginIpRatelimit.limit).mockResolvedValueOnce({
        success: false,
        limit: 20,
        remaining: 0,
        reset: Date.now() + 60000,
      });

      const request = new Request("https://chaptr.app/api/auth/callback/credentials", {
        headers: { "x-vercel-forwarded-for": "10.0.0.2" },
      });

      await expect(
        authorize(
          { email: "user@example.com", password: "password123" },
          request
        )
      ).rejects.toThrow(RateLimitError);

      expect(db.user.findUnique).not.toHaveBeenCalled();
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it("fails closed with ServiceUnavailableError when rate limiter throws", async () => {
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(authLoginEmailRatelimit.limit).mockRejectedValueOnce(
        new Error("Upstash Redis connection timeout")
      );

      const request = new Request("https://chaptr.app/api/auth/callback/credentials", {
        headers: { "x-vercel-forwarded-for": "10.0.0.1" },
      });

      await expect(
        authorize(
          { email: "user@example.com", password: "password123" },
          request
        )
      ).rejects.toThrow(ServiceUnavailableError);

      expect(db.user.findUnique).not.toHaveBeenCalled();
      expect(bcrypt.compare).not.toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it("executes dummy bcrypt compare for unknown user to prevent timing attack", async () => {
      vi.mocked(db.user.findUnique).mockResolvedValue(null);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      const request = new Request("https://chaptr.app/api/auth/callback/credentials");
      const result = await authorize(
        { email: "unknown@example.com", password: "password123" },
        request
      );

      expect(result).toBeNull();
      // Dummy bcrypt compare MUST be called with DUMMY_HASH
      expect(bcrypt.compare).toHaveBeenCalledWith(
        "password123",
        DUMMY_HASH
      );
    });

    it("returns null when password does not match", async () => {
      const mockUser = {
        id: "u-123",
        name: "Test Reader",
        email: "reader@chaptr.app",
        password: "hashed-password",
        image: null,
      };

      vi.mocked(db.user.findUnique).mockResolvedValue(mockUser as never);
      vi.mocked(bcrypt.compare).mockResolvedValue(false as never);

      const request = new Request("https://chaptr.app/api/auth/callback/credentials");
      const result = await authorize(
        { email: "reader@chaptr.app", password: "wrongpassword123" },
        request
      );

      expect(result).toBeNull();
      expect(bcrypt.compare).toHaveBeenCalledWith(
        "wrongpassword123",
        "hashed-password"
      );
    });

    it("returns null immediately when credentials do not pass loginSchema", async () => {
      const request = new Request("https://chaptr.app/api/auth/callback/credentials");
      // Empty password fails loginSchema (min 1 char)
      const result = await authorize(
        { email: "reader@chaptr.app", password: "" },
        request
      );

      expect(result).toBeNull();
      expect(db.user.findUnique).not.toHaveBeenCalled();
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });
  });
});
