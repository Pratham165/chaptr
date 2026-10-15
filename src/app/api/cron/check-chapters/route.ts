import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { runChapterCheck } from "@/lib/chapters";

export const dynamic = "force-dynamic";
export const maxDuration = 10; // 10s aligns with Vercel Hobby serverless function timeout

/**
 * Constant-time string equality comparison using crypto.timingSafeEqual.
 * Protects against timing attacks.
 */
function timingSafeEqualCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

async function handleCheckChapters(request: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;

  // FAIL CLOSED: if CRON_SECRET is unset or shorter than 32 characters, return 500 and never run
  if (!cronSecret || typeof cronSecret !== "string" || cronSecret.length < 32) {
    console.error(
      "Cron check rejected: CRON_SECRET environment variable is unset or shorter than 32 characters."
    );
    return new NextResponse(null, { status: 500 });
  }

  // Require Authorization: Bearer <CRON_SECRET> header
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new NextResponse(null, { status: 401 });
  }

  const token = authHeader.slice(7);
  if (!timingSafeEqualCompare(token, cronSecret)) {
    return new NextResponse(null, { status: 401 });
  }

  // Read batchSize and timeBudgetMs from environment with safe defaults (batch 30, budget 7000ms)
  const envBatch = process.env.CRON_BATCH_SIZE
    ? parseInt(process.env.CRON_BATCH_SIZE, 10)
    : NaN;
  const envBudget = process.env.CRON_TIME_BUDGET_MS
    ? parseInt(process.env.CRON_TIME_BUDGET_MS, 10)
    : NaN;

  const batchSize = !isNaN(envBatch) && envBatch > 0 ? envBatch : 30;
  const timeBudgetMs = !isNaN(envBudget) && envBudget > 0 ? envBudget : 7000;

  try {
    const summary = await runChapterCheck({ batchSize, timeBudgetMs });
    return NextResponse.json(summary);
  } catch (err: unknown) {
    console.error("Chapter check cron job execution failed:", err);
    return new NextResponse(null, { status: 500 });
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleCheckChapters(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleCheckChapters(request);
}
