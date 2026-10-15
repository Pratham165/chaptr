"use server";

import bcrypt from "bcrypt";
import { AuthError } from "next-auth";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import {
  signIn,
  RateLimitError,
  ServiceUnavailableError,
  BCRYPT_ROUNDS,
} from "@/lib/auth";
import { loginSchema, registerSchema } from "@/lib/validations/auth";
import {
  authRegisterEmailRatelimit,
  authRegisterIpRatelimit,
  getClientIp,
  warnMissingIpOnce,
} from "@/lib/redis";

export async function registerAction(formData: FormData) {
  const rawData = {
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  };

  const parsed = registerSchema.safeParse(rawData);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues?.[0]?.message || "Invalid registration data",
    };
  }

  const { name, email, password } = parsed.data;

  // Rate limit registration by normalized email AND client IP (if available)
  let ip: string | null = null;
  try {
    const reqHeaders = await headers();
    ip = getClientIp(reqHeaders);
  } catch {
    // Fallback when called outside of active request context (e.g. testing)
  }

  if (!ip) {
    warnMissingIpOnce();
  }

  try {
    const limitPromises: Promise<{ success: boolean }>[] = [
      authRegisterEmailRatelimit.limit(email),
    ];
    if (ip) {
      limitPromises.push(authRegisterIpRatelimit.limit(ip));
    }

    const results = await Promise.all(limitPromises);
    const isRateLimited = results.some((r) => !r.success);

    if (isRateLimited) {
      return {
        success: false,
        error: "Too many registration attempts. Please try again later.",
      };
    }
  } catch (err: unknown) {
    console.error("Registration rate limit check failed:", err);
    return {
      success: false,
      error: "Service temporarily unavailable. Please try again later.",
    };
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

  try {
    await db.user.create({
      data: {
        name,
        email,
        password: hashedPassword,
      },
    });

    return { success: true };
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      return {
        success: false,
        error: "An account with this email already exists",
      };
    }
    console.error("User registration failed:", err);
    return {
      success: false,
      error: "Something went wrong. Please try again.",
    };
  }
}

export async function loginAction(formData: FormData) {
  const rawData = {
    email: formData.get("email"),
    password: formData.get("password"),
  };

  const parsed = loginSchema.safeParse(rawData);
  if (!parsed.success) {
    return {
      success: false,
      error: "Invalid email or password",
    };
  }

  const { email, password } = parsed.data;

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/library",
    });
    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) {
      const authErr = error as AuthError & {
        code?: string;
        cause?: { err?: unknown };
      };

      const isRateLimited =
        authErr instanceof RateLimitError ||
        authErr.code === "rate_limit_exceeded" ||
        authErr.cause?.err instanceof RateLimitError ||
        (typeof authErr.cause?.err === "object" &&
          authErr.cause?.err !== null &&
          "code" in authErr.cause.err &&
          (authErr.cause.err as { code: string }).code === "rate_limit_exceeded") ||
        (authErr.cause?.err instanceof Error &&
          authErr.cause.err.message.includes("rate_limit"));

      if (isRateLimited) {
        return {
          success: false,
          error: "Too many login attempts. Please try again later.",
        };
      }

      const isServiceUnavailable =
        authErr instanceof ServiceUnavailableError ||
        authErr.code === "service_unavailable" ||
        authErr.cause?.err instanceof ServiceUnavailableError ||
        (typeof authErr.cause?.err === "object" &&
          authErr.cause?.err !== null &&
          "code" in authErr.cause.err &&
          (authErr.cause.err as { code: string }).code === "service_unavailable") ||
        (authErr.cause?.err instanceof Error &&
          (authErr.cause.err.message.includes("service_unavailable") ||
            authErr.cause.err.message.includes("temporarily unavailable")));

      if (isServiceUnavailable) {
        return {
          success: false,
          error: "Service temporarily unavailable. Please try again later.",
        };
      }

      // Return a single generic error for genuine bad credentials
      return {
        success: false,
        error: "Invalid email or password",
      };
    }
    throw error;
  }
}
