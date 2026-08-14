#!/usr/bin/env node
import fs from "node:fs";

import { runCli } from "./app.js";
import { isJsonObject } from "./api-types.js";
import { errorMessage } from "./errors.js";

const version = readPackageVersion();

runCli(process.argv.slice(2), { version }).catch((error: unknown) => {
  console.error(errorMessage(error));
  process.exitCode = 1;
});

function readPackageVersion(): string {
  const packageJson: unknown = JSON.parse(
    fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  if (!isJsonObject(packageJson) || typeof packageJson.version !== "string") {
    throw new Error("Could not read the pushover CLI version.");
  }
  return packageJson.version;
}
