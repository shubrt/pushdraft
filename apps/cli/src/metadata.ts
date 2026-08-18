import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

export interface GitMetadata {
  repoOrg: string | null;
  repoName: string | null;
  repoHost: string | null;
  gitBranch: string | null;
  gitCommitSha: string | null;
  gitCommitSubject: string | null;
  gitDirty: boolean | null;
}

export interface CiMetadata {
  ciProvider?: "github_actions" | "unknown";
  ciRunUrl?: string | null;
  ciActor?: string | null;
}

export interface ParsedRemote {
  host?: string;
  org?: string;
  name?: string;
}

export function collectGitMetadata(cwd: string): GitMetadata {
  const repoRoot = git(["rev-parse", "--show-toplevel"], cwd);
  const remote = git(["config", "--get", "remote.origin.url"], cwd);
  const parsedRemote = parseRemote(remote);
  const status = git(["status", "--porcelain"], cwd);

  return {
    repoOrg: parsedRemote.org ?? inferOrgFromRoot(repoRoot),
    repoName: parsedRemote.name ?? (repoRoot === null ? null : path.basename(repoRoot)),
    repoHost: parsedRemote.host ?? null,
    gitBranch: git(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    gitCommitSha: git(["rev-parse", "HEAD"], cwd),
    gitCommitSubject: git(["log", "-1", "--format=%s"], cwd),
    gitDirty: status === null ? null : status.length > 0,
  };
}

// CI values describe where an upload came from. The API never trusts them for access control.
export function collectCiMetadata(
  env: Readonly<Record<string, string | undefined>> = process.env,
): CiMetadata {
  if (env.GITHUB_ACTIONS === "true") {
    const server = env.GITHUB_SERVER_URL ?? "https://github.com";
    const repository = env.GITHUB_REPOSITORY;
    const runId = env.GITHUB_RUN_ID;
    return {
      ciProvider: "github_actions",
      ciRunUrl:
        repository !== undefined && runId !== undefined
          ? `${server}/${repository}/actions/runs/${runId}`
          : null,
      ciActor: env.GITHUB_ACTOR ?? null,
    };
  }

  return env.CI === undefined || env.CI === "" ? {} : { ciProvider: "unknown" };
}

export function parseRemote(remote: string | null | undefined): ParsedRemote {
  if (remote === null || remote === undefined || remote === "") return {};

  const cleaned = remote.trim().replace(/\.git$/, "");
  const scpMatch = cleaned.match(/^[^@]+@([^:]+):([^/]+)\/(.+)$/);
  if (scpMatch !== null) {
    const host = scpMatch[1];
    const org = scpMatch[2];
    const repositoryPath = scpMatch[3];
    if (host !== undefined && org !== undefined && repositoryPath !== undefined) {
      return { host, org, name: path.basename(repositoryPath) };
    }
  }

  try {
    const url = new URL(cleaned);
    const parts = url.pathname.split("/").filter(Boolean);
    const org = parts[0];
    const name = parts.at(-1);
    if (parts.length >= 2 && org !== undefined && name !== undefined) {
      return { host: url.hostname, org, name };
    }
  } catch {
    // Some git clients accept owner/repository without a URL scheme.
  }

  const parts = cleaned.split("/").filter(Boolean);
  const org = parts.at(-2);
  const name = parts.at(-1);
  return org === undefined || name === undefined ? {} : { org, name };
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function inferOrgFromRoot(repoRoot: string | null): string | null {
  return repoRoot === null ? null : path.basename(path.dirname(repoRoot));
}
