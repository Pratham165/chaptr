import { describe, it, expect } from "vitest";
import { loginSchema, registerSchema } from "./auth";

describe("Auth Validation Schemas", () => {
  describe("Email Normalization (loginSchema & registerSchema)", () => {
    it("trims and lowercases email before validation in loginSchema", () => {
      const result = loginSchema.safeParse({
        email: "   Reader@Example.COM   ",
        password: "password123",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe("reader@example.com");
      }
    });

    it("trims and lowercases email before validation in registerSchema", () => {
      const result = registerSchema.safeParse({
        name: "Test User",
        email: "   NEW.User@DOMAIN.co.uk   ",
        password: "password123",
        confirmPassword: "password123",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe("new.user@domain.co.uk");
      }
    });

    it("rejects invalid emails after trimming and lowercasing", () => {
      const invalidEmails = [
        "not-an-email",
        "@example.com",
        "user@",
        "user@.",
        "   ",
        "",
      ];

      for (const email of invalidEmails) {
        const loginRes = loginSchema.safeParse({
          email,
          password: "password123",
        });
        expect(loginRes.success).toBe(false);

        const regRes = registerSchema.safeParse({
          name: "Test User",
          email,
          password: "password123",
          confirmPassword: "password123",
        });
        expect(regRes.success).toBe(false);
      }
    });
  });

  describe("Password Limits & Strength (loginSchema vs registerSchema)", () => {
    it("allows an 8-character password to pass loginSchema and fail registerSchema", () => {
      const pass8 = "pass1234"; // 8 characters
      expect(pass8.length).toBe(8);

      // loginSchema must pass
      const loginRes = loginSchema.safeParse({
        email: "user@example.com",
        password: pass8,
      });
      expect(loginRes.success).toBe(true);

      // registerSchema must fail
      const regRes = registerSchema.safeParse({
        name: "Test User",
        email: "user@example.com",
        password: pass8,
        confirmPassword: pass8,
      });
      expect(regRes.success).toBe(false);
      if (!regRes.success) {
        expect(regRes.error.issues[0]?.message).toMatch(
          /Password must be at least 10 characters long/i
        );
      }
    });

    it("rejects empty password in loginSchema", () => {
      const res = loginSchema.safeParse({
        email: "user@example.com",
        password: "",
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toMatch(/Password is required/i);
      }
    });

    it("rejects passwords shorter than 10 characters in registerSchema", () => {
      const shortPasswords = [
        "",
        "1",
        "12345",
        "123456789", // 9 characters
        "shortpass", // 9 characters
      ];

      for (const password of shortPasswords) {
        const regRes = registerSchema.safeParse({
          name: "Test User",
          email: "user@example.com",
          password,
          confirmPassword: password,
        });
        expect(regRes.success).toBe(false);
        if (!regRes.success) {
          expect(regRes.error.issues[0]?.message).toMatch(
            /Password must be at least 10 characters long/i
          );
        }
      }
    });

    it("accepts valid ASCII passwords between 10 characters and 72 bytes in registerSchema", () => {
      // 10 characters
      const minPass = "1234567890";
      expect(
        registerSchema.safeParse({
          name: "Test User",
          email: "user@example.com",
          password: minPass,
          confirmPassword: minPass,
        }).success
      ).toBe(true);

      // Exactly 72 bytes (72 ASCII characters)
      const maxPass = "a".repeat(72);
      expect(Buffer.byteLength(maxPass, "utf-8")).toBe(72);
      expect(
        registerSchema.safeParse({
          name: "Test User",
          email: "user@example.com",
          password: maxPass,
          confirmPassword: maxPass,
        }).success
      ).toBe(true);
    });

    it("rejects ASCII passwords exceeding 72 bytes in both loginSchema and registerSchema", () => {
      // 73 ASCII characters = 73 bytes
      const over72Pass = "a".repeat(73);
      expect(Buffer.byteLength(over72Pass, "utf-8")).toBe(73);

      const loginRes = loginSchema.safeParse({
        email: "user@example.com",
        password: over72Pass,
      });
      expect(loginRes.success).toBe(false);
      if (!loginRes.success) {
        expect(loginRes.error.issues[0]?.message).toMatch(
          /Password cannot exceed 72 bytes/i
        );
      }

      const regRes = registerSchema.safeParse({
        name: "Test User",
        email: "user@example.com",
        password: over72Pass,
        confirmPassword: over72Pass,
      });
      expect(regRes.success).toBe(false);
      if (!regRes.success) {
        expect(regRes.error.issues[0]?.message).toMatch(
          /Password cannot exceed 72 bytes/i
        );
      }
    });

    describe("Multi-byte character handling", () => {
      it("accepts passwords with multi-byte characters when valid", () => {
        // Japanese: 15 characters * 3 bytes/char = 45 bytes (>= 10 chars and <= 72 bytes)
        const japanesePass = "あいうえおかきくけこさしすせそ";
        expect(japanesePass.length).toBe(15);
        expect(Buffer.byteLength(japanesePass, "utf-8")).toBe(45);

        expect(
          loginSchema.safeParse({
            email: "user@example.com",
            password: japanesePass,
          }).success
        ).toBe(true);

        expect(
          registerSchema.safeParse({
            name: "Test User",
            email: "user@example.com",
            password: japanesePass,
            confirmPassword: japanesePass,
          }).success
        ).toBe(true);
      });

      it("rejects multi-byte passwords with < 10 chars in registerSchema but accepts in loginSchema", () => {
        // 9 characters of 3-byte Japanese = 27 bytes (byte count <= 72, char count 9 < 10)
        const nineChars = "あいうえおかきくけ";
        expect(nineChars.length).toBe(9);
        expect(Buffer.byteLength(nineChars, "utf-8")).toBe(27);

        // loginSchema accepts (non-empty, <= 72 bytes)
        expect(
          loginSchema.safeParse({
            email: "user@example.com",
            password: nineChars,
          }).success
        ).toBe(true);

        // registerSchema rejects (< 10 chars)
        const regRes = registerSchema.safeParse({
          name: "Test User",
          email: "user@example.com",
          password: nineChars,
          confirmPassword: nineChars,
        });
        expect(regRes.success).toBe(false);
        if (!regRes.success) {
          expect(regRes.error.issues[0]?.message).toMatch(
            /Password must be at least 10 characters long/i
          );
        }
      });

      it("rejects multi-byte passwords exceeding 72 bytes in both schemas", () => {
        // 25 characters of 3-byte Japanese: 25 * 3 = 75 bytes
        const japaneseLong = "あ".repeat(25);
        expect(japaneseLong.length).toBe(25);
        expect(Buffer.byteLength(japaneseLong, "utf-8")).toBe(75);

        const loginRes = loginSchema.safeParse({
          email: "user@example.com",
          password: japaneseLong,
        });
        expect(loginRes.success).toBe(false);
        if (!loginRes.success) {
          expect(loginRes.error.issues[0]?.message).toMatch(
            /Password cannot exceed 72 bytes/i
          );
        }

        const regRes = registerSchema.safeParse({
          name: "Test User",
          email: "user@example.com",
          password: japaneseLong,
          confirmPassword: japaneseLong,
        });
        expect(regRes.success).toBe(false);
        if (!regRes.success) {
          expect(regRes.error.issues[0]?.message).toMatch(
            /Password cannot exceed 72 bytes/i
          );
        }
      });
    });
  });

  describe("registerSchema confirmations and fields", () => {
    it("fails when password and confirmPassword do not match", () => {
      const res = registerSchema.safeParse({
        name: "Test User",
        email: "user@example.com",
        password: "password123",
        confirmPassword: "password456",
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toBe("Passwords do not match");
      }
    });

    it("fails when name is shorter than 2 characters", () => {
      const res = registerSchema.safeParse({
        name: "A",
        email: "user@example.com",
        password: "password123",
        confirmPassword: "password123",
      });

      expect(res.success).toBe(false);
    });

    it("rejects whitespace-only name", () => {
      const res = registerSchema.safeParse({
        name: "     ",
        email: "user@example.com",
        password: "password123",
        confirmPassword: "password123",
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toMatch(/Name must be at least 2 characters long/i);
      }
    });

    it("rejects name longer than 60 characters (61 characters)", () => {
      const res = registerSchema.safeParse({
        name: "a".repeat(61),
        email: "user@example.com",
        password: "password123",
        confirmPassword: "password123",
      });

      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.issues[0]?.message).toMatch(/Name cannot exceed 60 characters/i);
      }
    });

    it("accepts a 60-character name and trims surrounding whitespace", () => {
      const sixtyChars = "a".repeat(60);
      const res = registerSchema.safeParse({
        name: `   ${sixtyChars}   `,
        email: "user@example.com",
        password: "password123",
        confirmPassword: "password123",
      });

      expect(res.success).toBe(true);
      if (res.success) {
        expect(res.data.name).toBe(sixtyChars);
      }
    });
  });
});
