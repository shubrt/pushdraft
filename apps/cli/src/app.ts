import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import * as readline from "node:readline/promises";
import type { RasterImageMediaType, UploadPayloadInput } from "@pushdraft/contracts";

import {
  apiErrorMessage,
  parseDraftsResponse,
  parseMeResponse,
  parseUploadResponse,
} from "./api-types.js";
import { parseCliArgs } from "./args.js";
import { CliError } from "./errors.js";
import { formatDrafts } from "./format.js";
import { requestJson, type Fetch } from "./http.js";
import { collectCiMetadata, collectGitMetadata, sha256 } from "./metadata.js";
import {
  createStatePaths,
  fingerprintApiKey,
  mappedDraftId,
  readAuth,
  readDraftState,
  saveCredentials,
  writeDraftState,
  type StatePaths,
} from "./state.js";

export interface CliOutput {
  log(message?: string): void;
  warn(message?: string): void;
}

export interface RunCliOptions {
  fetchImpl?: Fetch;
  output?: CliOutput;
  statePaths?: StatePaths;
  version: string;
}

const consoleOutput: CliOutput = {
  log: (message = "") => console.log(message),
  warn: (message = "") => console.warn(message),
};

export async function runCli(argv: string[], options: RunCliOptions): Promise<void> {
  const command = parseCliArgs(argv);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const output = options.output ?? consoleOutput;
  const statePaths = options.statePaths ?? createStatePaths();

  switch (command.kind) {
    case "help":
      output.log(command.text);
      return;
    case "version":
      output.log(options.version);
      return;
    case "auth-set":
      saveCredentials(statePaths, command.apiKey, command.apiUrl);
      output.log("pushdraft credentials saved.");
      return;
    case "auth-login":
      await login(command.apiUrl, statePaths, fetchImpl, output, options.version);
      return;
    case "whoami":
      await whoami(command.apiUrl, statePaths, fetchImpl, output, options.version);
      return;
    case "upload":
      await upload(command, statePaths, fetchImpl, output, options.version);
      return;
    case "list":
      await listDrafts(
        command.apiUrl,
        command.json,
        statePaths,
        fetchImpl,
        output,
        options.version,
      );
  }
}

async function login(
  apiUrlOverride: string | undefined,
  statePaths: StatePaths,
  fetchImpl: Fetch,
  output: CliOutput,
  version: string,
): Promise<void> {
  const { apiUrl } = readAuth(statePaths, { apiUrlOverride, requireApiKey: false });

  output.log("Open this in your browser on any device:\n");
  output.log(`  ${apiUrl}/cli/auth\n`);
  output.log("Sign in, generate a key, then paste it below.\n");

  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  let apiKey: string;
  try {
    apiKey = (
      await Promise.race<string>([
        terminal.question("Paste your API key: "),
        once(terminal, "close").then(() => ""),
      ])
    ).trim();
  } finally {
    terminal.close();
  }

  if (apiKey === "") throw new CliError("No key entered. Nothing saved.");

  const { body, response } = await requestJson(fetchImpl, `${apiUrl}/api/me`, {
    headers: authenticatedHeaders(apiKey, version),
  });
  if (!response.ok)
    throw new CliError(apiErrorMessage(body, "That key was rejected. Nothing saved."));

  const me = parseMeResponse(body);
  if (me === null) throw new CliError("The server returned an unexpected account response.");

  saveCredentials(statePaths, apiKey, apiUrlOverride, me.accountId);
  output.log(`\nLogged in as ${me.accountName} (key: ${me.apiKeyName}).`);
}

async function whoami(
  apiUrlOverride: string | undefined,
  statePaths: StatePaths,
  fetchImpl: Fetch,
  output: CliOutput,
  version: string,
): Promise<void> {
  const { apiUrl, apiKey } = readAuth(statePaths, { apiUrlOverride });
  const { body, response } = await requestJson(fetchImpl, `${apiUrl}/api/me`, {
    headers: authenticatedHeaders(requireApiKey(apiKey), version),
  });
  if (!response.ok) throw new CliError(apiErrorMessage(body, "Authentication failed."));

  const me = parseMeResponse(body);
  if (me === null) throw new CliError("The server returned an unexpected account response.");
  output.log(`Account: ${me.accountName} (${me.accountId})`);
  output.log(`API key: ${me.apiKeyName} (${me.apiKeyId})`);
}

interface UploadCommand {
  file: string;
  draftId?: string;
  forceNew: boolean;
  description?: string;
  references?: Record<string, string>;
  apiUrl?: string;
}

type UploadFile =
  | { kind: "html"; html: string }
  | { kind: "image"; bytes: Buffer; mediaType: RasterImageMediaType };

const imageMediaTypes = new Map<string, RasterImageMediaType>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

async function upload(
  command: UploadCommand,
  statePaths: StatePaths,
  fetchImpl: Fetch,
  output: CliOutput,
  version: string,
): Promise<void> {
  const resolvedFile = path.resolve(command.file);
  const auth = readAuth(statePaths, { apiUrlOverride: command.apiUrl });
  const apiKey = requireApiKey(auth.apiKey);
  const apiUrl = auth.apiUrl;
  const apiKeyFingerprint = fingerprintApiKey(apiKey);
  const file = readUploadFile(resolvedFile);
  if (file.kind === "image" && command.references !== undefined) {
    throw new CliError("References can only be attached to HTML uploads.");
  }
  const draftState = readDraftState(statePaths);
  const draftId = command.forceNew
    ? null
    : (command.draftId ??
      mappedDraftId(draftState, resolvedFile, apiUrl, apiKeyFingerprint, auth.accountId) ??
      null);

  const metadata = {
    ...collectGitMetadata(path.dirname(resolvedFile)),
    ...collectCiMetadata(),
    cliVersion: version,
    fileSha256: sha256(file.kind === "html" ? file.html : file.bytes),
  };
  const sharedPayload = {
    filename: path.basename(resolvedFile),
    draftId,
    description: command.description,
    metadata,
  };
  const payload =
    file.kind === "html"
      ? ({
          ...sharedPayload,
          html: file.html,
          ...(command.references === undefined ? {} : { references: command.references }),
        } satisfies UploadPayloadInput)
      : ({
          ...sharedPayload,
          image: { mediaType: file.mediaType, base64: file.bytes.toString("base64") },
        } satisfies UploadPayloadInput);

  const { body, response } = await requestJson(fetchImpl, `${apiUrl}/api/uploads`, {
    method: "POST",
    headers: {
      ...authenticatedHeaders(apiKey, version),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new CliError(apiErrorMessage(body, "Upload failed."));

  const result = parseUploadResponse(body);
  if (result === null) throw new CliError("The server returned an unexpected upload response.");
  const rawUrl = result.rawUrl;

  draftState.files[resolvedFile] = {
    draftId: result.draftId,
    publicUrl: result.publicUrl,
    rawUrl,
    latestVersionNumber: result.versionNumber,
    updatedAt: new Date().toISOString(),
    apiUrl,
    apiKeyFingerprint,
    accountId: auth.accountId,
  };
  writeDraftState(statePaths, draftState);

  output.log(draftId === null ? "Uploaded draft" : "Updated draft");
  output.log(`URL: ${result.publicUrl}`);
  output.log(`Raw ${file.kind === "html" ? "HTML" : "image"}: ${rawUrl}`);
  output.log(`Draft ID: ${result.draftId}`);
  output.log(`Version: ${result.versionNumber}`);
  for (const warning of result.warnings) output.warn(`Warning: ${warning}`);
}

async function listDrafts(
  apiUrlOverride: string | undefined,
  json: boolean,
  statePaths: StatePaths,
  fetchImpl: Fetch,
  output: CliOutput,
  version: string,
): Promise<void> {
  const { apiUrl, apiKey } = readAuth(statePaths, { apiUrlOverride });
  const { body, response } = await requestJson(fetchImpl, `${apiUrl}/api/drafts`, {
    headers: authenticatedHeaders(requireApiKey(apiKey), version),
  });
  if (!response.ok) throw new CliError(apiErrorMessage(body, "Failed to list drafts."));

  const drafts = parseDraftsResponse(body);
  if (drafts === null) throw new CliError("The server returned an unexpected draft list.");
  output.log(json ? JSON.stringify(drafts, null, 2) : formatDrafts(drafts));
}

function readUploadFile(filename: string): UploadFile {
  const extension = path.extname(filename).toLowerCase();
  const mediaType = imageMediaTypes.get(extension);

  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(filename);
  } catch (error) {
    if (!fs.existsSync(filename)) throw new CliError(`File does not exist: ${filename}`);
    throw new CliError(`Could not read file: ${filename}`, { cause: error });
  }

  if (mediaType !== undefined) {
    if (bytes.length === 0) throw new CliError("Image file is empty.");
    return { kind: "image", bytes, mediaType };
  }

  const html = bytes.toString("utf8");
  if (html.trim() === "") throw new CliError("HTML document is empty.");
  return { kind: "html", html };
}

function authenticatedHeaders(apiKey: string, version: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "User-Agent": `pushdraft/${version}`,
  };
}

function requireApiKey(apiKey: string | undefined): string {
  if (apiKey === undefined) throw new CliError("Missing API key. Run: pushdraft auth login");
  return apiKey;
}
