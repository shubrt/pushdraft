#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DRAFT_ID = /^[a-z0-9]{12}$/;

function version(value) {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 2147483647) {
    throw new Error("Invalid draft version.");
  }
  return Number(value);
}

/** Resolve only URLs on the configured Pushdraft origin or one draft subdomain. */
export function resolveDraftUrl(input, apiUrl = "https://pushdraft.dev") {
  const apex = new URL(apiUrl);
  const url = new URL(input);
  if (
    !["http:", "https:"].includes(apex.protocol) ||
    apex.username ||
    apex.password ||
    apex.search ||
    apex.hash ||
    apex.pathname !== "/"
  )
    throw new Error("API URL must be a bare http(s) origin.");
  if (url.username || url.password || url.protocol !== apex.protocol || url.port !== apex.port) {
    throw new Error("Draft URL does not match the configured API origin.");
  }
  const pathname = url.pathname.replace(/\/$/, "");
  let draftId;
  let versionNumber;
  if (url.hostname === apex.hostname) {
    if (pathname.startsWith("/s/")) {
      throw new Error("Guest share URLs do not support raw access. Ask for an owner draft URL.");
    }
    draftId = pathname.slice(1);
    if (!DRAFT_ID.test(draftId))
      throw new Error("Unsupported Pushdraft URL. Use a draft content URL.");
    const queries = [...url.searchParams];
    if (queries.length) {
      if (queries.length !== 1 || queries[0][0] !== "version") {
        throw new Error("Unsupported draft URL query.");
      }
      versionNumber = version(queries[0][1]);
    }
  } else {
    const suffix = `.${apex.hostname}`;
    draftId = url.hostname.endsWith(suffix) ? url.hostname.slice(0, -suffix.length) : "";
    if (!DRAFT_ID.test(draftId))
      throw new Error("Draft URL does not match the configured API origin.");
    if (url.search) throw new Error("Unsupported draft URL query.");
    if (pathname !== "" && pathname !== "/raw") {
      const match = pathname.match(/^\/v\/(\d+)(?:\/raw)?$/);
      if (!match) throw new Error("Unsupported draft content path.");
      versionNumber = version(match[1]);
    }
  }
  const raw = new URL(apex);
  raw.hostname = `${draftId}.${apex.hostname}`;
  raw.pathname = versionNumber === undefined ? "/raw" : `/v/${versionNumber}/raw`;
  return { rawUrl: raw.toString(), draftId, versionNumber };
}

/**
 * Fetch, verify, read and remove a private temporary file for this request.
 * @param {{ rawUrl: string, draftId: string, versionNumber?: number }} target
 * @param {string} apiKey
 * @param {{ fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>, tempRoot?: string }} options
 */
export async function readDraft(target, apiKey, { fetchImpl = fetch, tempRoot = tmpdir() } = {}) {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new Error("Missing API key. Run: npx pushdraft auth login");
  }
  const response = await fetchImpl(target.rawUrl, {
    headers: { authorization: `Bearer ${apiKey.trim()}` },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (response.status !== 200) throw new Error(`Draft request failed: HTTP ${response.status}.`);
  const returnedVersion = response.headers.get("x-postplan-draft-version") ?? "";
  if (
    response.headers.get("x-postplan-draft-id") !== target.draftId ||
    !/^\d+$/.test(returnedVersion) ||
    Number(returnedVersion) < 1 ||
    Number(returnedVersion) > 2147483647 ||
    (target.versionNumber !== undefined && Number(returnedVersion) !== target.versionNumber)
  )
    throw new Error("Response is not the requested draft. It may be a sign-in page.");
  if (response.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "text/html") {
    throw new Error("This draft is not HTML.");
  }
  const directory = await mkdtemp(path.join(tempRoot, "pushdraft-read-"));
  try {
    const filename = path.join(directory, "draft.html");
    await writeFile(filename, new Uint8Array(await response.arrayBuffer()), {
      mode: 0o600,
      flag: "wx",
    });
    return await readFile(filename, "utf8");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function readJson(filename) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error(`Could not read ${path.basename(filename)}.`);
  }
}

async function main() {
  const [input, option, override, ...extra] = process.argv.slice(2);
  if (!input || (option !== undefined && (option !== "--api-url" || !override)) || extra.length) {
    throw new Error("Usage: node read.mjs <draft-url> [--api-url <origin>]");
  }
  const stateDirectory = path.join(homedir(), ".pushdraft");
  const config = await readJson(path.join(stateDirectory, "config.json"));
  const target = resolveDraftUrl(
    input,
    override ?? process.env.API_URL ?? config.apiUrl ?? "https://pushdraft.dev",
  );
  const credentials = await readJson(path.join(stateDirectory, "credentials.json"));
  const apiKey = process.env.API_KEY?.trim() || credentials.apiKey;
  const html = await readDraft(target, apiKey);
  process.stdout.write(html);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
