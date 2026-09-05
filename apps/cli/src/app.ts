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
  type UploadResponse,
} from "./api-types.js";
import { parseCliArgs } from "./args.js";
import { CliError, errorMessage } from "./errors.js";
import { formatDrafts } from "./format.js";
import { requestJson, type Fetch } from "./http.js";
import { collectCiMetadata, collectGitMetadata, sha256 } from "./metadata.js";
import { readReferencesManifest, type LocalImageReference } from "./references-manifest.js";
import {
  createStatePaths,
  fingerprintApiKey,
  mappedDraftId,
  readAuth,
  readDraftState,
  saveCredentials,
  setDraftMapping,
  writeDraftState,
  type DraftState,
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
  referencesFile?: string;
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

const MAX_PARALLEL_IMAGE_UPLOADS = 4;

interface UploadEnvironment {
  apiKey: string;
  apiUrl: string;
  apiKeyFingerprint: string;
  accountId?: string;
  fetchImpl: Fetch;
  version: string;
}

interface ImageUploadPlan {
  filename: string;
  referenceNames: string[];
}

interface CompletedImageUpload {
  plan: ImageUploadPlan;
  previousDraftId: string | null;
  result: UploadResponse;
}

interface FailedImageUpload {
  plan: ImageUploadPlan;
  error: unknown;
}

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
  if (
    file.kind === "image" &&
    (command.references !== undefined || command.referencesFile !== undefined)
  ) {
    throw new CliError("References can only be attached to HTML uploads.");
  }

  const localReferences =
    command.referencesFile === undefined ? [] : readReferencesManifest(command.referencesFile);
  validateReferenceNames(command.references, localReferences);
  const imagePlans = prepareImageUploads(localReferences);
  const draftState = readDraftState(statePaths);
  const environment: UploadEnvironment = {
    apiKey,
    apiUrl,
    apiKeyFingerprint,
    accountId: auth.accountId,
    fetchImpl,
    version,
  };

  const { completed, failed } = await uploadReferencedImages(imagePlans, draftState, environment);
  for (const upload of completed) {
    storeDraftMapping(draftState, upload.plan.filename, upload.result, environment);
  }
  if (completed.length > 0) {
    writeDraftState(statePaths, draftState);
    logImageUploads(completed, output);
  }
  if (failed.length > 0) throw imageUploadError(failed);

  const references = mergeReferences(command.references, completed);
  const draftId = command.forceNew
    ? null
    : (command.draftId ??
      mappedDraftId(draftState, resolvedFile, apiUrl, apiKeyFingerprint, auth.accountId) ??
      null);
  const result = await uploadFile(
    resolvedFile,
    file,
    draftId,
    command.description,
    references,
    environment,
  );

  storeDraftMapping(draftState, resolvedFile, result, environment);
  writeDraftState(statePaths, draftState);

  output.log(draftId === null ? "Uploaded draft" : "Updated draft");
  output.log(`URL: ${result.publicUrl}`);
  output.log(`Raw ${file.kind === "html" ? "HTML" : "image"}: ${result.rawUrl}`);
  output.log(`Draft ID: ${result.draftId}`);
  output.log(`Version: ${result.versionNumber}`);
  for (const warning of result.warnings) output.warn(`Warning: ${warning}`);
}

function validateReferenceNames(
  explicitReferences: Record<string, string> | undefined,
  localReferences: LocalImageReference[],
): void {
  if (explicitReferences === undefined) return;
  const duplicate = localReferences.find((reference) =>
    Object.hasOwn(explicitReferences, reference.name),
  );
  if (duplicate !== undefined) {
    throw new CliError(`Duplicate reference name across --ref and --refs-file: ${duplicate.name}.`);
  }
}

function prepareImageUploads(references: LocalImageReference[]): ImageUploadPlan[] {
  const uploadsByFilename = new Map<string, ImageUploadPlan>();
  for (const reference of references) {
    const existing = uploadsByFilename.get(reference.filename);
    if (existing !== undefined) {
      existing.referenceNames.push(reference.name);
      continue;
    }

    validateReferencedImage(reference);
    uploadsByFilename.set(reference.filename, {
      filename: reference.filename,
      referenceNames: [reference.name],
    });
  }
  return [...uploadsByFilename.values()];
}

async function uploadReferencedImages(
  plans: ImageUploadPlan[],
  draftState: DraftState,
  environment: UploadEnvironment,
): Promise<{ completed: CompletedImageUpload[]; failed: FailedImageUpload[] }> {
  const completed: CompletedImageUpload[] = [];
  const failed: FailedImageUpload[] = [];

  for (let offset = 0; offset < plans.length; offset += MAX_PARALLEL_IMAGE_UPLOADS) {
    const batch = plans.slice(offset, offset + MAX_PARALLEL_IMAGE_UPLOADS);
    const results = await Promise.allSettled(
      batch.map(async (plan) => {
        const file = readUploadFile(plan.filename);
        if (file.kind !== "image") {
          throw new CliError(`Referenced file is no longer a supported image: ${plan.filename}`);
        }
        const previousDraftId =
          mappedDraftId(
            draftState,
            plan.filename,
            environment.apiUrl,
            environment.apiKeyFingerprint,
            environment.accountId,
          ) ?? null;
        const result = await uploadFile(
          plan.filename,
          file,
          previousDraftId,
          undefined,
          undefined,
          environment,
        );
        return { plan, previousDraftId, result };
      }),
    );

    results.forEach((result, index) => {
      const plan = batch[index];
      if (plan === undefined) return;
      if (result.status === "fulfilled") completed.push(result.value);
      else failed.push({ plan, error: result.reason });
    });
  }

  return { completed, failed };
}

function validateReferencedImage(reference: LocalImageReference): void {
  if (!imageMediaTypes.has(path.extname(reference.filename).toLowerCase())) {
    throw new CliError(
      `Reference "${reference.name}" must point to a .png, .jpg, .jpeg, or .webp file: ${reference.filename}`,
    );
  }

  try {
    fs.accessSync(reference.filename, fs.constants.R_OK);
    const file = fs.statSync(reference.filename);
    if (!file.isFile()) throw new Error("Not a regular file.");
    if (file.size === 0) throw new CliError(`Image file is empty: ${reference.filename}`);
  } catch (error) {
    if (error instanceof CliError) throw error;
    if (!fs.existsSync(reference.filename)) {
      throw new CliError(`File does not exist: ${reference.filename}`);
    }
    throw new CliError(`Could not read file: ${reference.filename}`, { cause: error });
  }
}

async function uploadFile(
  resolvedFile: string,
  file: UploadFile,
  draftId: string | null,
  description: string | undefined,
  references: Record<string, string> | undefined,
  environment: UploadEnvironment,
): Promise<UploadResponse> {
  const metadata = {
    ...collectGitMetadata(path.dirname(resolvedFile)),
    ...collectCiMetadata(),
    cliVersion: environment.version,
    fileSha256: sha256(file.kind === "html" ? file.html : file.bytes),
  };
  const sharedPayload = {
    filename: path.basename(resolvedFile),
    draftId,
    description,
    metadata,
  };
  const payload =
    file.kind === "html"
      ? ({
          ...sharedPayload,
          html: file.html,
          ...(references === undefined ? {} : { references }),
        } satisfies UploadPayloadInput)
      : ({
          ...sharedPayload,
          image: { mediaType: file.mediaType, base64: file.bytes.toString("base64") },
        } satisfies UploadPayloadInput);

  const { body, response } = await requestJson(
    environment.fetchImpl,
    `${environment.apiUrl}/api/uploads`,
    {
      method: "POST",
      headers: {
        ...authenticatedHeaders(environment.apiKey, environment.version),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) throw new CliError(apiErrorMessage(body, "Upload failed."));

  const result = parseUploadResponse(body);
  if (result === null) throw new CliError("The server returned an unexpected upload response.");
  return result;
}

function storeDraftMapping(
  draftState: DraftState,
  filename: string,
  result: UploadResponse,
  environment: UploadEnvironment,
): void {
  setDraftMapping(draftState, filename, {
    draftId: result.draftId,
    publicUrl: result.publicUrl,
    rawUrl: result.rawUrl,
    latestVersionNumber: result.versionNumber,
    updatedAt: new Date().toISOString(),
    apiUrl: environment.apiUrl,
    apiKeyFingerprint: environment.apiKeyFingerprint,
    accountId: environment.accountId,
  });
}

function mergeReferences(
  explicitReferences: Record<string, string> | undefined,
  uploads: CompletedImageUpload[],
): Record<string, string> | undefined {
  if (explicitReferences === undefined && uploads.length === 0) return undefined;
  const references = { ...explicitReferences };
  for (const upload of uploads) {
    for (const name of upload.plan.referenceNames) references[name] = upload.result.draftId;
  }
  return references;
}

function logImageUploads(uploads: CompletedImageUpload[], output: CliOutput): void {
  for (const upload of uploads) {
    const action = upload.previousDraftId === null ? "Uploaded" : "Updated";
    const names = upload.plan.referenceNames.join(", ");
    output.log(`${action} image reference ${names}: ${upload.result.draftId}`);
    for (const warning of upload.result.warnings) {
      output.warn(`Warning for image reference ${names}: ${warning}`);
    }
  }
}

function imageUploadError(failures: FailedImageUpload[]): CliError {
  const details = failures.map((failure) => {
    const names = failure.plan.referenceNames.join(", ");
    return `${names} (${failure.plan.filename}): ${errorMessage(failure.error)}`;
  });
  return new CliError(
    `Failed to upload ${failures.length} referenced image${failures.length === 1 ? "" : "s"}. The HTML draft was not uploaded.\n- ${details.join("\n- ")}`,
  );
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
