import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's `"@/*": ["./*"]` path mapping — needed so
    // a test can load a route/module that imports via `@/lib/...`
    // (the style most of this app's non-test-covered files already
    // use) without Vite failing to resolve it. Every existing
    // *tested* Skidmarks API route avoided `@/` imports specifically to
    // dodge this gap; adding the alias here instead of perpetuating
    // that workaround in every new file.
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
