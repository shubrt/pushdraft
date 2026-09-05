import assert from "node:assert/strict";
import { describe, test } from "vite-plus/test";
import {
  apiErrorSchema,
  contentDescriptorSchema,
  draftDetailResponseSchema,
  draftListResponseSchema,
  fileDescriptorSchema,
  meResponseSchema,
  uploadPayloadSchema,
  uploadResponseSchema,
} from "../src/index.ts";

const draftId = "q43kvvtxix1x";
const createdAt = "2026-08-13T20:30:00.000Z";
const sha256 = "a".repeat(64);

const draft = {
  draftId,
  title: "Private Postplan",
  description: null,
  repoOrg: "shubrt",
  repoName: "pushdraft",
  repoHost: "github.com",
  latestVersionNumber: 1,
  versionCount: 1,
  createdAt,
  updatedAt: createdAt,
  latestVersionAt: createdAt,
  disabled: false,
  publicUrl: `https://${draftId}.pushdraft.example`,
  rawUrl: `https://${draftId}.pushdraft.example/raw`,
};

describe("upload contracts", () => {
  test("accepts the original CLI payload and response fields", () => {
    assert.doesNotThrow(() =>
      uploadPayloadSchema.parse({
        html: "<!doctype html><title>Private Postplan</title>",
        filename: "plan.html",
        draftId: null,
        metadata: {
          repoOrg: "shubrt",
          repoName: "pushdraft",
          repoHost: "github.com",
          gitBranch: "main",
          gitCommitSha: "a".repeat(40),
          gitCommitSubject: "docs: add plan",
          gitDirty: false,
          cliVersion: "0.0.4",
          fileSha256: sha256,
        },
      }),
    );

    assert.doesNotThrow(() =>
      uploadResponseSchema.parse({
        ok: true,
        draftId,
        versionId: "JzH3fQ8am2n4VKgTb9Xe",
        versionNumber: 1,
        title: "Private Postplan",
        requestId: null,
        publicUrl: `https://${draftId}.pushdraft.example`,
        rawUrl: `https://${draftId}.pushdraft.example/raw`,
        warnings: [],
      }),
    );
  });

  test("rejects draft IDs that cannot be used as Postplan subdomains", () => {
    assert.throws(() =>
      uploadPayloadSchema.parse({
        html: "<title>Plan</title>",
        filename: "plan.html",
        draftId: "Not-A-Draft",
      }),
    );
  });

  test("accepts an HTML-only request and ignores unknown root fields", () => {
    const parsed = uploadPayloadSchema.parse({
      html: "<title>Plan</title>",
      ignored: "root fields are not metadata",
    });

    assert.equal(parsed.filename, undefined);
    assert.equal("ignored" in parsed, false);
  });

  test("accepts named draft references on HTML uploads", () => {
    const parsed = uploadPayloadSchema.parse({
      html: '<img src="./refs/hero-image">',
      references: {
        "hero-image": draftId,
      },
    });

    assert.deepEqual(parsed.references, { "hero-image": draftId });
  });

  test("rejects invalid HTML reference names and draft IDs", () => {
    assert.throws(() =>
      uploadPayloadSchema.parse({
        html: '<img src="./refs/Hero">',
        references: { Hero: draftId },
      }),
    );
    assert.throws(() =>
      uploadPayloadSchema.parse({
        html: '<img src="./refs/hero">',
        references: { hero: "too-short" },
      }),
    );
  });

  test("accepts raster image uploads and rejects references on them", () => {
    for (const mediaType of ["image/png", "image/jpeg", "image/webp"] as const) {
      assert.doesNotThrow(() =>
        uploadPayloadSchema.parse({
          image: { mediaType, base64: Buffer.from("image bytes").toString("base64") },
          filename: `image.${mediaType.slice("image/".length)}`,
        }),
      );
    }

    assert.throws(() =>
      uploadPayloadSchema.parse({
        image: { mediaType: "image/png", base64: "aW1hZ2U=" },
        references: { hero: draftId },
      }),
    );
    assert.throws(() =>
      uploadPayloadSchema.parse({
        html: "<title>Mixed payload</title>",
        image: { mediaType: "image/png", base64: "aW1hZ2U=" },
      }),
    );
  });

  test("requires CI run URLs to match the output URL contract", () => {
    for (const ciRunUrl of ["not a URL", "", "/relative/run/42"]) {
      assert.equal(
        uploadPayloadSchema.safeParse({ html: "<title>Plan</title>", metadata: { ciRunUrl } })
          .success,
        false,
      );
    }
  });

  test("keeps additional metadata and free-form descriptive text", () => {
    const description = "d".repeat(1_001);
    const parsed = uploadPayloadSchema.parse({
      html: "<title>Plan</title>",
      description,
      metadata: {
        repoOrg: "o".repeat(300),
        gitCommitSha: "not-a-git-hash",
        fileSha256: "not-a-content-hash",
        ciRunUrl: "https://ci.example/run/42",
        agent: { name: "custom-agent", run: 42 },
      },
    });

    assert.equal(parsed.description, description);
    assert.equal(parsed.metadata?.gitCommitSha, "not-a-git-hash");
    assert.equal(parsed.metadata?.ciRunUrl, "https://ci.example/run/42");
    assert.deepEqual(parsed.metadata?.agent, { name: "custom-agent", run: 42 });
  });
});

describe("draft contracts", () => {
  test("parses list and detail responses", () => {
    assert.doesNotThrow(() => draftListResponseSchema.parse({ ok: true, drafts: [draft] }));

    assert.doesNotThrow(() =>
      draftDetailResponseSchema.parse({
        ok: true,
        draft,
        versions: [
          {
            versionId: "JzH3fQ8am2n4VKgTb9Xe",
            versionNumber: 1,
            createdAt,
            publicUrl: `https://${draftId}.pushdraft.example/v/1`,
            rawUrl: `https://${draftId}.pushdraft.example/v/1/raw`,
            file: {
              fileId: "Sb3aXw8uFrQ9tL5mN2pK",
              filename: "plan.html",
              byteSize: 48,
              sha256,
              content: { kind: "html", mediaType: "text/html" },
            },
            metadata: {
              gitBranch: "main",
              gitCommitSha: "a".repeat(40),
              gitCommitSubject: "docs: add plan",
              gitDirty: false,
              cliVersion: "0.0.4",
              ciProvider: null,
              ciRunUrl: null,
              ciActor: null,
            },
          },
        ],
      }),
    );
  });
});

describe("public file contracts", () => {
  test("distinguishes HTML, PDF, and raster images without storage fields", () => {
    assert.deepEqual(contentDescriptorSchema.parse({ kind: "html", mediaType: "text/html" }), {
      kind: "html",
      mediaType: "text/html",
    });
    assert.deepEqual(contentDescriptorSchema.parse({ kind: "pdf", mediaType: "application/pdf" }), {
      kind: "pdf",
      mediaType: "application/pdf",
    });
    assert.deepEqual(contentDescriptorSchema.parse({ kind: "image", mediaType: "image/webp" }), {
      kind: "image",
      mediaType: "image/webp",
    });

    assert.throws(() =>
      fileDescriptorSchema.parse({
        fileId: "Sb3aXw8uFrQ9tL5mN2pK",
        filename: "plan.html",
        byteSize: 48,
        sha256,
        content: { kind: "html", mediaType: "text/html" },
        objectKey: "drafts/private/plan.html",
      }),
    );
  });
});

describe("identity and error contracts", () => {
  test("keeps the original me response shape", () => {
    assert.doesNotThrow(() =>
      meResponseSchema.parse({
        accountId: "acct_private",
        accountName: "Janis",
        apiKeyId: "key_cli",
        apiKeyName: "CLI",
      }),
    );
  });

  test("accepts message and validation errors", () => {
    assert.doesNotThrow(() =>
      apiErrorSchema.parse({ ok: false, error: "Missing or invalid API key." }),
    );
    assert.doesNotThrow(() =>
      apiErrorSchema.parse({
        ok: false,
        errors: ["HTML is required."],
        warnings: [],
      }),
    );
  });
});
