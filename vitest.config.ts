import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@render-experiment/store": resolve(__dirname, "./packages/core/store/src"),
      "@render-experiment/store-react": resolve(
        __dirname,
        "./packages/react/store/src",
      ),
      "@render-experiment/machine-core": resolve(
        __dirname,
        "./packages/core/machine/src",
      ),
    },
  },
  test: {
    globals: false,
    // jsdom only kicks in for files that opt in via `@vitest-environment jsdom`.
    environment: "node",
  },
});
