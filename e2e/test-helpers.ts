import crypto from "crypto";

/**
 * Generates a per-run random password for E2E tests.
 */
export function generateTestPassword(prefix = "TestPass"): string {
  const randomSuffix = crypto.randomBytes(8).toString("hex");
  return `${prefix}_${randomSuffix}!`;
}
