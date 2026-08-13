import { z } from "zod";

const textSchema = z.string().min(1);
const optionalMetadataStringSchema = z.string().nullable().optional();

export const draftIdSchema = z
  .string()
  .regex(/^[a-z0-9]{12}$/, "Draft IDs must contain 12 lowercase letters or digits.");

export const entityIdSchema = z.string().min(1).max(128);
export const versionNumberSchema = z.number().int().positive();
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const urlSchema = z.string().url();
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, "Expected a SHA-256 hash.");

export const uploadMetadataSchema = z
  .object({
    repoOrg: optionalMetadataStringSchema,
    repoName: optionalMetadataStringSchema,
    repoHost: optionalMetadataStringSchema,
    gitBranch: optionalMetadataStringSchema,
    gitCommitSha: optionalMetadataStringSchema,
    gitCommitSubject: optionalMetadataStringSchema,
    gitDirty: z.boolean().nullable().optional(),
    cliVersion: optionalMetadataStringSchema,
    fileSha256: optionalMetadataStringSchema,
    ciProvider: optionalMetadataStringSchema,
    ciRunUrl: optionalMetadataStringSchema,
    ciActor: optionalMetadataStringSchema,
  })
  .passthrough();

export const uploadPayloadSchema = z.object({
  html: z.string().min(1),
  filename: z.string().optional(),
  draftId: draftIdSchema.nullable().optional(),
  description: z.string().optional(),
  metadata: uploadMetadataSchema.optional(),
});

export const uploadResponseSchema = z
  .object({
    ok: z.literal(true),
    draftId: draftIdSchema,
    versionId: entityIdSchema,
    versionNumber: versionNumberSchema,
    title: textSchema,
    requestId: z.string().nullable(),
    publicUrl: urlSchema,
    rawUrl: urlSchema,
    warnings: z.array(z.string()),
  })
  .strict();

export const htmlContentDescriptorSchema = z
  .object({
    kind: z.literal("html"),
    mediaType: z.literal("text/html"),
  })
  .strict();

export const pdfContentDescriptorSchema = z
  .object({
    kind: z.literal("pdf"),
    mediaType: z.literal("application/pdf"),
  })
  .strict();

export const contentDescriptorSchema = z.discriminatedUnion("kind", [
  htmlContentDescriptorSchema,
  pdfContentDescriptorSchema,
]);

// Storage location and stored bytes belong to the persistence layer, not API responses.
export const fileDescriptorSchema = z
  .object({
    fileId: entityIdSchema,
    filename: z.string().min(1).max(255).nullable(),
    byteSize: z.number().int().nonnegative(),
    sha256: sha256Schema,
    content: contentDescriptorSchema,
  })
  .strict();

export const repositoryMetadataSchema = z
  .object({
    repoOrg: z.string().nullable(),
    repoName: z.string().nullable(),
    repoHost: z.string().nullable(),
  })
  .strict();

export const draftSummarySchema = z
  .object({
    draftId: draftIdSchema,
    title: textSchema,
    description: z.string().nullable(),
    ...repositoryMetadataSchema.shape,
    latestVersionNumber: versionNumberSchema.nullable(),
    versionCount: z.number().int().nonnegative(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
    latestVersionAt: isoDateTimeSchema.nullable(),
    disabled: z.boolean(),
    publicUrl: urlSchema,
    rawUrl: urlSchema,
  })
  .strict();

export const draftListResponseSchema = z
  .object({
    ok: z.literal(true),
    drafts: z.array(draftSummarySchema),
  })
  .strict();

export const versionMetadataSchema = z
  .object({
    gitBranch: z.string().nullable(),
    gitCommitSha: z.string().nullable(),
    gitCommitSubject: z.string().nullable(),
    gitDirty: z.boolean().nullable(),
    cliVersion: z.string().nullable(),
    ciProvider: z.string().nullable(),
    ciRunUrl: urlSchema.nullable(),
    ciActor: z.string().nullable(),
  })
  .strict();

export const draftVersionSchema = z
  .object({
    versionId: entityIdSchema,
    versionNumber: versionNumberSchema,
    createdAt: isoDateTimeSchema,
    publicUrl: urlSchema,
    rawUrl: urlSchema,
    file: fileDescriptorSchema,
    metadata: versionMetadataSchema,
  })
  .strict();

export const draftDetailResponseSchema = z
  .object({
    ok: z.literal(true),
    draft: draftSummarySchema,
    versions: z.array(draftVersionSchema),
  })
  .strict();

export const meResponseSchema = z
  .object({
    accountId: entityIdSchema,
    accountName: textSchema,
    apiKeyId: entityIdSchema,
    apiKeyName: textSchema,
  })
  .strict();

export const messageApiErrorSchema = z
  .object({
    ok: z.literal(false),
    error: textSchema,
  })
  .strict();

export const validationApiErrorSchema = z
  .object({
    ok: z.literal(false),
    errors: z.array(textSchema).min(1),
    warnings: z.array(z.string()),
  })
  .strict();

export const apiErrorSchema = z.union([messageApiErrorSchema, validationApiErrorSchema]);

export type DraftId = z.output<typeof draftIdSchema>;

export type UploadMetadataInput = z.input<typeof uploadMetadataSchema>;
export type UploadMetadataOutput = z.output<typeof uploadMetadataSchema>;
export type UploadMetadata = UploadMetadataOutput;

export type UploadPayloadInput = z.input<typeof uploadPayloadSchema>;
export type UploadPayloadOutput = z.output<typeof uploadPayloadSchema>;
export type UploadPayload = UploadPayloadOutput;

export type UploadResponseInput = z.input<typeof uploadResponseSchema>;
export type UploadResponseOutput = z.output<typeof uploadResponseSchema>;
export type UploadResponse = UploadResponseOutput;

export type ContentDescriptorInput = z.input<typeof contentDescriptorSchema>;
export type ContentDescriptorOutput = z.output<typeof contentDescriptorSchema>;
export type ContentDescriptor = ContentDescriptorOutput;

export type FileDescriptorInput = z.input<typeof fileDescriptorSchema>;
export type FileDescriptorOutput = z.output<typeof fileDescriptorSchema>;
export type FileDescriptor = FileDescriptorOutput;

export type RepositoryMetadataInput = z.input<typeof repositoryMetadataSchema>;
export type RepositoryMetadataOutput = z.output<typeof repositoryMetadataSchema>;
export type RepositoryMetadata = RepositoryMetadataOutput;

export type DraftSummaryInput = z.input<typeof draftSummarySchema>;
export type DraftSummaryOutput = z.output<typeof draftSummarySchema>;
export type DraftSummary = DraftSummaryOutput;

export type DraftListResponseInput = z.input<typeof draftListResponseSchema>;
export type DraftListResponseOutput = z.output<typeof draftListResponseSchema>;
export type DraftListResponse = DraftListResponseOutput;

export type VersionMetadataInput = z.input<typeof versionMetadataSchema>;
export type VersionMetadataOutput = z.output<typeof versionMetadataSchema>;
export type VersionMetadata = VersionMetadataOutput;

export type DraftVersionInput = z.input<typeof draftVersionSchema>;
export type DraftVersionOutput = z.output<typeof draftVersionSchema>;
export type DraftVersion = DraftVersionOutput;

export type DraftDetailResponseInput = z.input<typeof draftDetailResponseSchema>;
export type DraftDetailResponseOutput = z.output<typeof draftDetailResponseSchema>;
export type DraftDetailResponse = DraftDetailResponseOutput;

export type MeResponseInput = z.input<typeof meResponseSchema>;
export type MeResponseOutput = z.output<typeof meResponseSchema>;
export type MeResponse = MeResponseOutput;

export type MessageApiErrorInput = z.input<typeof messageApiErrorSchema>;
export type MessageApiErrorOutput = z.output<typeof messageApiErrorSchema>;
export type MessageApiError = MessageApiErrorOutput;

export type ValidationApiErrorInput = z.input<typeof validationApiErrorSchema>;
export type ValidationApiErrorOutput = z.output<typeof validationApiErrorSchema>;
export type ValidationApiError = ValidationApiErrorOutput;

export type ApiErrorInput = z.input<typeof apiErrorSchema>;
export type ApiErrorOutput = z.output<typeof apiErrorSchema>;
export type ApiError = ApiErrorOutput;
