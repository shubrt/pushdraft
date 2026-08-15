import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { isJsonObject } from "./api-types.js";
import { CliError } from "./errors.js";

export const DEFAULT_API_URL = "https://pushdraft.dev";

export interface StatePaths {
  directory: string;
  config: string;
  credentials: string;
  drafts: string;
}

export interface AuthConfig {
  apiUrl?: string;
}

export interface Credentials {
  apiKey?: string;
  accountId?: string;
  updatedAt?: string;
}

export interface Auth {
  apiUrl: string;
  apiKey?: string;
  accountId?: string;
}

export interface DraftMapping {
  draftId: string;
  publicUrl: string;
  rawUrl: string;
  latestVersionNumber: number;
  updatedAt: string;
  apiUrl?: string;
  apiKeyFingerprint?: string;
  accountId?: string;
}

export interface DraftState {
  files: Record<string, DraftMapping>;
}

interface ResolveAuthOptions {
  apiUrlOverride?: string;
  env: Readonly<Record<string, string | undefined>>;
  config: AuthConfig;
  credentials: Credentials;
  requireApiKey?: boolean;
}

export function createStatePaths(homeDirectory = os.homedir()): StatePaths {
  const directory = path.join(homeDirectory, ".pushdraft");
  return {
    directory,
    config: path.join(directory, "config.json"),
    credentials: path.join(directory, "credentials.json"),
    drafts: path.join(directory, "drafts.json"),
  };
}

export function readAuth(
  paths: StatePaths,
  options: {
    apiUrlOverride?: string;
    env?: Readonly<Record<string, string | undefined>>;
    requireApiKey?: boolean;
  } = {},
): Auth {
  return resolveAuth({
    apiUrlOverride: options.apiUrlOverride,
    env: options.env ?? process.env,
    config: readConfig(paths),
    credentials: readCredentials(paths),
    requireApiKey: options.requireApiKey,
  });
}

export function resolveAuth(options: ResolveAuthOptions): Auth {
  const apiUrl = normalizeApiUrl(
    options.apiUrlOverride ?? options.env.API_URL ?? options.config.apiUrl ?? DEFAULT_API_URL,
  );
  const savedApiKey = nonEmpty(options.credentials.apiKey);
  const apiKey = nonEmpty(options.env.API_KEY) ?? savedApiKey;
  const accountId =
    apiKey !== undefined && apiKey === savedApiKey
      ? nonEmpty(options.credentials.accountId)
      : undefined;

  if ((options.requireApiKey ?? true) && apiKey === undefined) {
    throw new CliError("Missing API key. Run: pushdraft auth login");
  }

  return accountId === undefined ? { apiUrl, apiKey } : { apiUrl, apiKey, accountId };
}

export function saveCredentials(
  paths: StatePaths,
  apiKey: string,
  apiUrlOverride?: string,
  accountId?: string,
): void {
  const normalizedKey = apiKey.trim();
  if (normalizedKey === "") throw new CliError("API key cannot be empty.");

  ensureStateDirectory(paths);
  if (apiUrlOverride !== undefined) {
    writeJson(paths, paths.config, {
      ...readConfig(paths),
      apiUrl: normalizeApiUrl(apiUrlOverride),
    });
  }

  writeJson(paths, paths.credentials, {
    apiKey: normalizedKey,
    accountId: nonEmpty(accountId),
    updatedAt: new Date().toISOString(),
  });
}

export function readDraftState(paths: StatePaths): DraftState {
  const value = readJson(paths.drafts);
  if (!isJsonObject(value) || !isJsonObject(value.files)) return { files: {} };

  const files: Record<string, DraftMapping> = {};
  for (const [filename, mapping] of Object.entries(value.files)) {
    const parsed = parseDraftMapping(mapping);
    if (parsed !== null) files[filename] = parsed;
  }
  return { files };
}

export function writeDraftState(paths: StatePaths, state: DraftState): void {
  writeJson(paths, paths.drafts, state);
}

export function mappedDraftId(
  state: DraftState,
  filename: string,
  apiUrl: string,
  apiKeyFingerprint: string,
  accountId?: string,
): string | undefined {
  const mapping = state.files[filename];
  if (mapping === undefined) return undefined;
  if (mapping.apiUrl === undefined || normalizeApiUrl(mapping.apiUrl) !== normalizeApiUrl(apiUrl)) {
    return undefined;
  }

  if (accountId !== undefined && mapping.accountId !== undefined) {
    return accountId === mapping.accountId ? mapping.draftId : undefined;
  }

  // auth set, environment keys, and older mappings have no verified account.
  // An exact key match is the only safe fallback for those cases.
  return mapping.apiKeyFingerprint === apiKeyFingerprint ? mapping.draftId : undefined;
}

export function fingerprintApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function normalizeApiUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  if (normalized === "") throw new CliError("API URL cannot be empty.");

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new CliError(`Invalid API URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CliError("API URL must use http or https.");
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new CliError("API URL cannot contain credentials, a query, or a fragment.");
  }

  return normalized;
}

function readConfig(paths: StatePaths): AuthConfig {
  const value = readJson(paths.config);
  if (!isJsonObject(value)) return {};
  return typeof value.apiUrl === "string" ? { apiUrl: value.apiUrl } : {};
}

function readCredentials(paths: StatePaths): Credentials {
  const value = readJson(paths.credentials);
  if (!isJsonObject(value)) return {};

  return {
    apiKey: typeof value.apiKey === "string" ? value.apiKey : undefined,
    accountId: typeof value.accountId === "string" ? value.accountId : undefined,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
  };
}

function parseDraftMapping(value: unknown): DraftMapping | null {
  if (!isJsonObject(value)) return null;
  if (
    typeof value.draftId !== "string" ||
    typeof value.publicUrl !== "string" ||
    typeof value.rawUrl !== "string" ||
    typeof value.latestVersionNumber !== "number" ||
    typeof value.updatedAt !== "string" ||
    (value.apiUrl !== undefined && typeof value.apiUrl !== "string") ||
    (value.apiKeyFingerprint !== undefined && typeof value.apiKeyFingerprint !== "string") ||
    (value.accountId !== undefined && typeof value.accountId !== "string")
  ) {
    return null;
  }

  return {
    draftId: value.draftId,
    publicUrl: value.publicUrl,
    rawUrl: value.rawUrl,
    latestVersionNumber: value.latestVersionNumber,
    updatedAt: value.updatedAt,
    apiUrl: value.apiUrl,
    apiKeyFingerprint: value.apiKeyFingerprint,
    accountId: value.accountId,
  };
}

function readJson(filename: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filename, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function writeJson(paths: StatePaths, filename: string, value: unknown): void {
  ensureStateDirectory(paths);
  const temporaryFilename = `${filename}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryFilename, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.chmodSync(temporaryFilename, 0o600);
    fs.renameSync(temporaryFilename, filename);
    fs.chmodSync(filename, 0o600);
  } catch (error) {
    try {
      fs.unlinkSync(temporaryFilename);
    } catch {
      // The write may have failed before the temporary file existed.
    }
    throw new CliError(`Could not write ${filename}.`, { cause: error });
  }
}

function ensureStateDirectory(paths: StatePaths): void {
  fs.mkdirSync(paths.directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(paths.directory, 0o700);
}

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === "" ? undefined : normalized;
}
