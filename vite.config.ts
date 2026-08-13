import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    ignorePatterns: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.cache/**",
      "**/.vite/**",
      "**/.output/**",
      "**/.example/**",
      "**/.claude/**",
      "**/.gemini/**",
      "**/.cursor/**",
      "**/*.gen.ts",
      "docs/private-postplan-plan.html",
    ],
    options: { typeAware: true, typeCheck: true },
  },

  fmt: {
    ignorePatterns: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.cache/**",
      "**/.vite/**",
      "**/.output/**",
      "**/.example/**",
      "**/.claude/**",
      "**/.gemini/**",
      "**/.cursor/**",
      "**/*.gen.ts",
      "docs/private-postplan-plan.html",
    ],
  },

  staged: {
    "*.{js,jsx,ts,tsx,json,jsonc,css,md,mdx}": "vp check --fix",
  },
});
