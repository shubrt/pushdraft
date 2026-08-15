import {
  draftListResponseSchema,
  meResponseSchema,
  uploadResponseSchema,
  type DraftSummary,
  type MeResponse,
  type UploadResponse,
} from "@pushdraft/contracts";

export type { DraftSummary, MeResponse, UploadResponse };

type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseMeResponse(value: unknown): MeResponse | null {
  const result = meResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseUploadResponse(value: unknown): UploadResponse | null {
  const result = uploadResponseSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function parseDraftsResponse(value: unknown): DraftSummary[] | null {
  const result = draftListResponseSchema.safeParse(value);
  return result.success ? result.data.drafts : null;
}

export function apiErrorMessage(value: unknown, fallback: string): string {
  if (!isJsonObject(value)) return fallback;

  const message = typeof value.error === "string" ? value.error : fallback;
  const details = isStringArray(value.errors) ? value.errors : [];
  return details.length > 0 ? `${message}\n- ${details.join("\n- ")}` : message;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
