import type { AppConfig } from "../config";

const DRAFT_ID_PATTERN = /^[a-z0-9]{12}$/;

export function apexOrigin(config: Pick<AppConfig, "publicUrl">): string {
  return config.publicUrl.origin;
}

export function draftOrigin(config: Pick<AppConfig, "publicUrl">, draftId: string): string {
  assertDraftId(draftId);
  const url = new URL(config.publicUrl);
  url.hostname = `${draftId}.${url.hostname}`;
  return url.origin;
}

export function draftUrl(
  config: Pick<AppConfig, "publicUrl">,
  draftId: string,
  path = "/",
): string {
  const origin = draftOrigin(config, draftId);
  return path === "/" ? origin : new URL(path, `${origin}/`).toString();
}

export function draftIdFromHostname(
  config: Pick<AppConfig, "publicUrl">,
  hostname: string,
): string | null {
  const normalized = hostname.toLowerCase();
  if (normalized.endsWith(".")) return null;
  const apexHostname = config.publicUrl.hostname.toLowerCase();
  if (!normalized.endsWith(`.${apexHostname}`)) return null;
  const prefix = normalized.slice(0, -(apexHostname.length + 1));
  if (prefix.includes(".") || !DRAFT_ID_PATTERN.test(prefix)) return null;
  return prefix;
}

export function isApexHostname(config: Pick<AppConfig, "publicUrl">, hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return !normalized.endsWith(".") && normalized === config.publicUrl.hostname.toLowerCase();
}

export function hasConfiguredPort(
  config: Pick<AppConfig, "publicUrl">,
  requestUrl: Pick<URL, "port">,
): boolean {
  return requestUrl.port === config.publicUrl.port;
}

export function safeApexPath(value: string | null | undefined, fallback = "/drafts"): string {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return fallback;
  }
  return value;
}

export function isDraftId(value: string): boolean {
  return DRAFT_ID_PATTERN.test(value);
}

function assertDraftId(value: string): void {
  if (!isDraftId(value)) throw new Error("Invalid draft id.");
}
