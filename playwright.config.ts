import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "apps/api/test",
  testMatch: "**/*.browser.ts",
  use: { browserName: "chromium" },
});
