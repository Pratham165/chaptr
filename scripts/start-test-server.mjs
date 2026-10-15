import { spawn } from "node:child_process";
import process from "node:process";
import path from "node:path";
import fs from "node:fs";

const url = process.env.DATABASE_URL;
let hostAndDb = "unknown";
if (url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname || "unknown";
    const dbname = parsed.pathname.replace(/^\/+/, "").split("/")[0] || "";
    hostAndDb = dbname ? `${host}/${dbname}` : host;
  } catch {
    hostAndDb = "invalid-url";
  }
}

// Log ONLY the database hostname and database name (no credentials, passwords, or query params)
console.log(`[Next.js Server] Database host: ${hostAndDb}`);

// Cross-platform start: invoke Next.js binary directly with current Node process (no shell or npm.cmd needed)
const nextBin = path.resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next");

let child;
if (fs.existsSync(nextBin)) {
  child = spawn(process.execPath, [nextBin, "start"], {
    stdio: "inherit",
    env: process.env,
  });
} else {
  // Cross-platform fallback: detect platform if running through npm
  const isWindows = process.platform === "win32";
  const executable = isWindows ? "npm.cmd" : "npm";
  child = spawn(executable, ["run", "start"], {
    stdio: "inherit",
    shell: isWindows,
    env: process.env,
  });
}

child.on("exit", (code, signal) => {
  if (code !== null) {
    process.exit(code);
  } else if (signal) {
    process.kill(process.pid, signal);
  }
});
