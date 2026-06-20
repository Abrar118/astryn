import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // Stub Tauri runtime modules — they are not available in the Node/jsdom test environment.
    // Tests only exercise the Markdown parse/serialize layer, not the Tauri IPC.
    alias: {
      "@tauri-apps/api/core": path.resolve(__dirname, "src/__mocks__/tauri-api-core.ts"),
      "@tauri-apps/plugin-opener": path.resolve(__dirname, "src/__mocks__/tauri-plugin-opener.ts"),
    },
  },
});
