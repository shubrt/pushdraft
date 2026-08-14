import { defineConfig } from "vite-plus";

export default defineConfig({
  // `vp test` runs every workspace suite from the repository root; each package
  // keeps its tests in `test/` next to `src/`.
  test: {
    include: ["{apps,libs}/*/test/**/*.test.ts"],
  },

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
    ],
  },

  staged: {
    "*.{js,jsx,ts,tsx,json,jsonc,css,md,mdx}": "vp check --fix",
  },
});
