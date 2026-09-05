import { afterEach, describe, expect, test } from "vite-plus/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import apiPackage from "../package.json";
import rootPackage from "../../../package.json";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

const fileEnv = {
  DATABASE_URL: "postgres://file:example@localhost/file",
  SESSION_SECRET: "file-secret-0123456789abcdef0123456789",
};
const injectedEnv = {
  DATABASE_URL: "postgres://injected:example@localhost/injected",
  SESSION_SECRET: "injected-secret-0123456789abcdef012345",
};

function fixture(withEnvFile: boolean): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pushdraft-env-scripts-"));
  directories.push(root);
  fs.mkdirSync(path.join(root, "apps/api/src/db"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      private: true,
      scripts: { "db:deploy": rootPackage.scripts["db:deploy"] },
    }),
  );
  fs.writeFileSync(path.join(root, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
  fs.writeFileSync(path.join(root, "apps/api/package.json"), JSON.stringify(apiPackage));
  fs.copyFileSync(
    fileURLToPath(new URL("../src/config.ts", import.meta.url)),
    path.join(root, "apps/api/src/config.ts"),
  );
  const probe = `import { loadConfig } from "./config.ts";
const config = loadConfig();
console.log(JSON.stringify({ databaseUrl: config.databaseUrl, sessionSecret: config.sessionSecret, cwd: process.cwd() }));
process.exit(0);`;
  fs.writeFileSync(path.join(root, "apps/api/src/index.ts"), probe);
  fs.writeFileSync(
    path.join(root, "apps/api/src/db/migrate.ts"),
    probe.replace('"./config.ts"', '"../config.ts"'),
  );
  if (withEnvFile)
    fs.writeFileSync(
      path.join(root, ".env"),
      Object.entries(fileEnv)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
    );
  return root;
}

function run(
  root: string,
  command: string,
  args: string[],
  env: Record<string, string>,
  fromPackage = false,
) {
  const output = execFileSync(command, args, {
    cwd: fromPackage ? path.join(root, "apps/api") : root,
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const line = output.split("\n").find((value) => value.startsWith("{"));
  if (line === undefined) throw new Error(`Missing config probe output: ${output}`);
  return JSON.parse(line) as { databaseUrl: string; sessionSecret: string; cwd: string };
}

describe("API script environment", () => {
  test.each(["dev", "start", "db:deploy", "db:push"])(
    "%s loads the root .env from the API directory",
    (script) => {
      const root = fixture(true);
      const config = run(root, "bun", ["run", script], {}, true);
      expect(config).toEqual({
        databaseUrl: fileEnv.DATABASE_URL,
        sessionSecret: fileEnv.SESSION_SECRET,
        cwd: fs.realpathSync(path.join(root, "apps/api")),
      });
    },
  );

  test.each([true, false])(
    "injected variables take precedence with .env present: %s",
    (withEnvFile) => {
      const root = fixture(withEnvFile);
      for (const script of ["dev", "start", "db:deploy", "db:push"]) {
        const config = run(root, "bun", ["run", script], injectedEnv, true);
        expect(config.databaseUrl).toBe(injectedEnv.DATABASE_URL);
        expect(config.sessionSecret).toBe(injectedEnv.SESSION_SECRET);
      }
    },
  );

  test.each([
    ["run", "db:deploy"],
    ["run", "-F", "@pushdraft/api", "dev"],
  ])("loads root config through vp %j", (...args) => {
    const root = fixture(true);
    const config = run(root, "vp", args, {});
    expect(config.databaseUrl).toBe(fileEnv.DATABASE_URL);
    expect(config.sessionSecret).toBe(fileEnv.SESSION_SECRET);
    expect(config.cwd).toBe(fs.realpathSync(path.join(root, "apps/api")));
  });
});
