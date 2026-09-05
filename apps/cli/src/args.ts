import { parseArgs } from "node:util";
import { draftIdSchema, draftReferenceNameSchema } from "@pushdraft/contracts";

import { CliError, errorMessage } from "./errors.js";

export type ParsedCommand =
  | { kind: "help"; text: string }
  | { kind: "version" }
  | { kind: "auth-set"; apiKey: string; apiUrl?: string }
  | { kind: "auth-login"; apiUrl?: string }
  | { kind: "whoami"; apiUrl?: string }
  | {
      kind: "upload";
      file: string;
      draftId?: string;
      forceNew: boolean;
      description?: string;
      references?: Record<string, string>;
      referencesFile?: string;
      apiUrl?: string;
    }
  | { kind: "list"; apiUrl?: string; json: boolean };

export const ROOT_HELP = `Usage: pushdraft <command> [options]

Publish private drafts to pushdraft.

Commands:
  auth set <api-key>  Save an API key
  auth login          Paste and verify a key from the browser
  whoami              Check the configured credentials
  upload <file>       Upload or update an HTML or image draft
  list                List drafts in your account

Options:
  -h, --help          Show help
  -V, --version       Show the CLI version`;

const AUTH_HELP = `Usage: pushdraft auth <command> [options]

Commands:
  set <api-key>       Save an API key
  login               Paste and verify a key from the browser`;

const AUTH_SET_HELP = `Usage: pushdraft auth set <api-key> [options]

Options:
  --api-url <url>     Override the pushdraft API base URL
  -h, --help          Show help`;

const AUTH_LOGIN_HELP = `Usage: pushdraft auth login [options]

Options:
  --api-url <url>     Override the pushdraft API base URL
  -h, --help          Show help`;

const WHOAMI_HELP = `Usage: pushdraft whoami [options]

Options:
  --api-url <url>     Override the pushdraft API base URL
  -h, --help          Show help`;

const UPLOAD_HELP = `Usage: pushdraft upload <file> [options]

Options:
  --draft <draft-id>   Update a specific draft
  --new                Always create a new draft
  --description <text> Set a short draft description
  --ref <name=id>      Attach an image draft to HTML (repeatable)
  --refs-file <path>   Upload image references from a JSON manifest
  --api-url <url>      Override the pushdraft API base URL
  -h, --help           Show help

References manifest example:
  {"hero":"./images/hero.webp","logo":"./images/logo.png"}
Image paths are resolved relative to the manifest.

Raster image extensions: .png, .jpg, .jpeg, .webp`;

const LIST_HELP = `Usage: pushdraft list [options]

Options:
  --api-url <url>     Override the pushdraft API base URL
  --json              Print the draft array as JSON
  -h, --help          Show help`;

export function parseCliArgs(argv: string[]): ParsedCommand {
  try {
    return parseCliArgsUnsafe(argv);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(errorMessage(error), { cause: error });
  }
}

function parseCliArgsUnsafe(argv: string[]): ParsedCommand {
  const [command, ...rest] = argv;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    return { kind: "help", text: ROOT_HELP };
  }
  if (command === "--version" || command === "-V") return { kind: "version" };

  switch (command) {
    case "auth":
      return parseAuthArgs(rest);
    case "whoami":
      return parseWhoamiArgs(rest);
    case "upload":
      return parseUploadArgs(rest);
    case "list":
      return parseListArgs(rest);
    default:
      throw new CliError(`Unknown command: ${command}\n\n${ROOT_HELP}`);
  }
}

function parseAuthArgs(argv: string[]): ParsedCommand {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    return { kind: "help", text: AUTH_HELP };
  }

  if (command === "set") {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      strict: true,
      options: {
        "api-url": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help === true) return { kind: "help", text: AUTH_SET_HELP };
    const apiKey = expectOnePositional(positionals, "API key", AUTH_SET_HELP);
    return { kind: "auth-set", apiKey, apiUrl: values["api-url"] };
  }

  if (command === "login") {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      strict: true,
      options: {
        "api-url": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help === true) return { kind: "help", text: AUTH_LOGIN_HELP };
    expectNoPositionals(positionals, AUTH_LOGIN_HELP);
    return { kind: "auth-login", apiUrl: values["api-url"] };
  }

  throw new CliError(`Unknown auth command: ${command}\n\n${AUTH_HELP}`);
}

function parseWhoamiArgs(argv: string[]): ParsedCommand {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "api-url": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help === true) return { kind: "help", text: WHOAMI_HELP };
  expectNoPositionals(positionals, WHOAMI_HELP);
  return { kind: "whoami", apiUrl: values["api-url"] };
}

function parseUploadArgs(argv: string[]): ParsedCommand {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      draft: { type: "string" },
      new: { type: "boolean" },
      description: { type: "string" },
      ref: { type: "string", multiple: true },
      "refs-file": { type: "string" },
      "api-url": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help === true) return { kind: "help", text: UPLOAD_HELP };
  const file = expectOnePositional(positionals, "file", UPLOAD_HELP);
  if (values.draft !== undefined && !draftIdSchema.safeParse(values.draft).success) {
    throw new CliError("Invalid --draft: expected 12 lowercase letters or digits.");
  }
  if (values.draft !== undefined && values.new === true) {
    throw new CliError("--draft and --new cannot be used together.");
  }
  const references = parseReferences(values.ref);
  return {
    kind: "upload",
    file,
    draftId: values.draft,
    forceNew: values.new ?? false,
    description: values.description,
    ...(references === undefined ? {} : { references }),
    ...(values["refs-file"] === undefined ? {} : { referencesFile: values["refs-file"] }),
    apiUrl: values["api-url"],
  };
}

function parseReferences(values: string[] | undefined): Record<string, string> | undefined {
  if (values === undefined) return undefined;

  const references = new Map<string, string>();
  for (const value of values) {
    const separatorIndex = value.indexOf("=");
    const name = value.slice(0, separatorIndex);
    const draftId = value.slice(separatorIndex + 1);
    const validName = separatorIndex > 0 && draftReferenceNameSchema.safeParse(name).success;
    const validDraftId = draftIdSchema.safeParse(draftId).success;
    if (!validName || !validDraftId) {
      throw new CliError(
        `Invalid reference: ${value}. Expected a lowercase name and a 12-character draft ID, for example hero=q43kvvtxix1x.`,
      );
    }
    if (references.has(name)) throw new CliError(`Duplicate reference name: ${name}.`);
    references.set(name, draftId);
  }

  return Object.fromEntries(references);
}

function parseListArgs(argv: string[]): ParsedCommand {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "api-url": { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help === true) return { kind: "help", text: LIST_HELP };
  expectNoPositionals(positionals, LIST_HELP);
  return { kind: "list", apiUrl: values["api-url"], json: values.json ?? false };
}

function expectOnePositional(values: string[], name: string, help: string): string {
  const [value] = values;
  if (value === undefined) throw new CliError(`Missing ${name}.\n\n${help}`);
  if (values.length > 1) throw new CliError(`Too many arguments.\n\n${help}`);
  return value;
}

function expectNoPositionals(values: string[], help: string): void {
  if (values.length > 0) throw new CliError(`Unexpected argument: ${values[0]}\n\n${help}`);
}
