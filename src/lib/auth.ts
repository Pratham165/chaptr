import NextAuth, { CredentialsSignin } from "next-auth";
import type { NextAuthConfig } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcrypt";
import db from "@/lib/db";
import { loginSchema } from "@/lib/validations/auth";
import {
  authLoginEmailRatelimit,
  authLoginIpRatelimit,
  getClientIp,
  warnMissingIpOnce,
} from "@/lib/redis";

export const BCRYPT_ROUNDS = 12;

// Precomputed valid bcrypt hash at cost 12 to equalize timing for nonexistent accounts without import-time CPU cost
export const DUMMY_HASH =
  "$2b$12$shKg3/5ibz/dWIRU6nkPE.YPHDLc7TMKBMKW7KrjFdONZH23bgh02";

export class RateLimitError extends CredentialsSignin {
  code = "rate_limit_exceeded";
}

export class ServiceUnavailableError extends CredentialsSignin {
  code = "service_unavailable";
  message = "Service temporarily unavailable. Please try again later.";
}

/**
 * Wraps PrismaAdapter so createUser lowercases the email and getUserByEmail lowercases
 * its lookup, ensuring OAuth (such as Google sign-in) stores and queries normalized emails.
 */
export function customPrismaAdapter(prisma: typeof db): Adapter {
  const base = PrismaAdapter(prisma);
  return {
    ...base,
    createUser(user: AdapterUser) {
      const email = user.email ? user.email.trim().toLowerCase() : user.email;
      return base.createUser!({ ...user, email });
    },
    getUserByEmail(email: string) {
      return base.getUserByEmail!(email.trim().toLowerCase());
    },
    updateUser(user: Partial<AdapterUser> & { id: string }) {
      const email = user.email ? user.email.trim().toLowerCase() : user.email;
      return base.updateUser!({ ...user, ...(user.email ? { email } : {}) } as AdapterUser);
    },
  };
}

export async function authorize(
  credentials: Partial<Record<string, unknown>> | undefined,
  request?: Request
) {
  const parsed = loginSchema.safeParse(credentials);
  if (!parsed.success) {
    return null;
  }

  const { email, password } = parsed.data;

  // Rate limit by normalized email AND client IP (if available)
  const ip = getClientIp(request);
  if (!ip) {
    warnMissingIpOnce();
  }

  try {
    const limitPromises: Promise<{ success: boolean }>[] = [
      authLoginEmailRatelimit.limit(email),
    ];
    if (ip) {
      limitPromises.push(authLoginIpRatelimit.limit(ip));
    }

    const results = await Promise.all(limitPromises);
    const isRateLimited = results.some((r) => !r.success);

    if (isRateLimited) {
      throw new RateLimitError();
    }
  } catch (err: unknown) {
    if (err instanceof RateLimitError) {
      throw err;
    }
    console.error("Login rate limit check failed:", err);
    throw new ServiceUnavailableError();
  }

  const user = await db.user.findUnique({
    where: { email },
  });

  if (!user || !user.password) {
    // Constant-time defense: run dummy bcrypt compare so timing does not leak account existence
    await bcrypt.compare(password, DUMMY_HASH);
    return null;
  }

  const passwordsMatch = await bcrypt.compare(password, user.password);

  if (!passwordsMatch) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
  };
}

const providers: NextAuthConfig["providers"] = [
  Credentials({
    name: "credentials",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    authorize,
  }),
];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.unshift(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  );
}

export const authConfig: NextAuthConfig = {
  adapter: customPrismaAdapter(db),
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
    updateAge: 24 * 60 * 60, // 1 day in seconds
  },
  providers,
  pages: {
    signIn: "/login",
  },
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
