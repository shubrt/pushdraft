import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { setTimeout } from "node:timers/promises";

import { CliError } from "./errors.js";

// Hard-linking a complete owner file makes acquisition atomic across processes.
// Locks are never stolen from a live process, even during a slow HTTP request.
export async function withFileLock<T>(filename: string, action: () => Promise<T>): Promise<T> {
  const owner = `${filename}.${process.pid}.${randomUUID()}`;
  fs.writeFileSync(owner, String(process.pid), { mode: 0o600, flag: "wx" });
  const deadline = Date.now() + 60_000;
  let acquired = false;
  try {
    while (!acquired) {
      try {
        fs.linkSync(owner, filename);
        acquired = true;
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
        // Fail closed after a crash: removing someone else's lock based on a
        // stale PID check can delete a newly acquired lock in another process.
        if (Date.now() >= deadline) {
          throw new CliError(
            `Timed out waiting for upload state lock ${filename}. If no upload is running, remove this lock and retry.`,
          );
        }
        await setTimeout(25);
      }
    }
    return await action();
  } finally {
    if (acquired) fs.unlinkSync(filename);
    fs.unlinkSync(owner);
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
