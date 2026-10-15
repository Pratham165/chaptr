import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;
import { PrismaClient } from "@prisma/client";
import process from "node:process";

// Load environment variables (.env, .env.local, etc.)
loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

/**
 * Read-only script that reports users whose email in the database
 * differs from its normalized lowercase form.
 *
 * Does NOT mutate, update, or delete any records.
 */
async function reportUnnormalizedEmails() {
  console.log("------------------------------------------------------------------");
  console.log("Chaptr Email Normalization Audit (READ-ONLY)");
  console.log("------------------------------------------------------------------");

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    const unnormalized = users.filter((u) => {
      if (!u.email) return false;
      return u.email !== u.email.trim().toLowerCase();
    });

    console.log(`Total users scanned: ${users.length}`);

    if (unnormalized.length === 0) {
      console.log("Result: All user emails are properly normalized in lowercase.");
      console.log("------------------------------------------------------------------");
      return;
    }

    console.log(`Result: Found ${unnormalized.length} user(s) with unnormalized emails:`);
    console.log("------------------------------------------------------------------");

    for (const user of unnormalized) {
      console.log(`User ID:          ${user.id}`);
      console.log(`Name:             ${user.name ?? "(no name)"}`);
      console.log(`Current Email:    ${user.email}`);
      console.log(`Normalized Email: ${user.email ? user.email.trim().toLowerCase() : ""}`);
      console.log(`Created At:       ${user.createdAt.toISOString()}`);
      console.log("------------------------------------------------------------------");
    }
  } finally {
    await prisma.$disconnect();
  }
}

reportUnnormalizedEmails().catch((err) => {
  console.error("Error auditing user emails:", err);
  process.exit(1);
});
