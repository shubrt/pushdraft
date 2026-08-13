import { parseArgs } from "node:util";

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
      apiUrl?: string;
    }
  | { kind: "list"; apiUrl?: string; json: boolean };

export const ROOT_HELP = `Usage: pp <command> [options]

Publish private HTML drafts to pp.

Commands:
  auth set <api-key>  Save an API key
  auth login          Paste and verify a key from the browser
  whoami              Check the configured credentials
  upload <file>       Upload or update an HTML draft
  list                List drafts in your account

Options:
  -h, --help          Show help
  -V, --version       Show the CLI version`;

const AUTH_HELP = `Usage: pp auth <command> [options]

Commands:
  set <api-key>       Save an API key
  login               Paste and verify a key from the browser`;

const AUTH_SET_HELP = `Usage: pp auth set <api-key> [options]

Options:
  --api-url <url>     Override the pp API base URL
  -h, --help          Show help`;

const AUTH_LOGIN_HELP = `Usage: pp auth login [options]

Options:
  --api-url <url>     Override the pp API base URL
  -h, --help          Show help`;

const WHOAMI_HELP = `Usage: pp whoami [options]

Options:
  --api-url <url>     Override the pp API base URL
  -h, --help          Show help`;

const UPLOAD_HELP = `Usage: pp upload <file> [options]

Options:
  --draft <draft-id>  Update a specific draft
  --new               Always create a new draft
  --description <text> Set a short draft description
  --api-url <url>     Override the pp API base URL
  -h, --help          Show help`;

const LIST_HELP = `Usage: pp list [options]

Options:
  --api-url <url>     Override the pp API base URL
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
      "api-url": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help === true) return { kind: "help", text: UPLOAD_HELP };
  const file = expectOnePositional(positionals, "file", UPLOAD_HELP);
  return {
    kind: "upload",
    file,
    draftId: values.draft,
    forceNew: values.new ?? false,
    description: values.description,
    apiUrl: values["api-url"],
  };
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
