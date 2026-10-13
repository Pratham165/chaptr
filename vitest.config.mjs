import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/.next/**", "**/e2e/**"],
    env: {
      DATABASE_URL: "postgresql://mock:mock@localhost:5432/mock",
      UPSTASH_REDIS_REST_URL: "https://mock.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "mock-token",
      MANGADEX_CONTACT: "https://github.com/chaptr/chaptr",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});

