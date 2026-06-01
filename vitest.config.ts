import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    dedupe: ["react", "react-dom"],
  },
  test: {
    globals: false,
    environment: "node",
    exclude: ["**/node_modules/**", "**/*.native.test.{ts,tsx}"],
  },
});
