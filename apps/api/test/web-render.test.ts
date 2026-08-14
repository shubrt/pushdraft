import { describe, expect, test } from "bun:test";
import type { DraftDetailResponse, DraftSummary } from "@pushover/contracts";

import type { WebSession } from "../src/auth/session";
import { renderCliAuth, renderDraftDetail, renderDrafts } from "../src/web/render";

const SESSION: WebSession = {
  id: "session_render",
  accountId: "account_render",
  accountName: "Janis",
  email: "janis@example.com",
  pictureUrl: null,
  csrfTokenHash: "hash",
};

const DRAFT: DraftSummary = {
  draftId: "nok4tarxkb27",
  title: "Private plan",
  description: null,
  repoOrg: "shubrt",
  repoName: "pushover",
  repoHost: "github.com",
  latestVersionNumber: 3,
  versionCount: 3,
  createdAt: "2026-08-13T11:22:00.000Z",
  updatedAt: "2026-08-13T16:07:00.000Z",
  latestVersionAt: "2026-08-13T16:07:00.000Z",
  disabled: false,
  publicUrl: "https://nok4tarxkb27.pushover.example",
  rawUrl: "https://nok4tarxkb27.pushover.example/raw",
};

describe("web rendering", () => {
  test("renders direction A with the lime accent and active draft navigation", () => {
    const rendered = renderDrafts(SESSION, "csrf", [DRAFT]);

    expect(rendered).toContain("--black:#000");
    expect(rendered).toContain("--accent:#dfff00");
    expect(rendered).not.toContain("#1d4ed8");
    expect(rendered).toContain('class="active" aria-current="page" href="/drafts"');
    expect(rendered).toContain('href="https://github.com/shubrt/pushover"');
    expect(rendered).toContain("v3");
    expect(rendered).toContain("3 versions");
  });

  test("escapes user and draft data before placing it in HTML", () => {
    const rendered = renderDrafts(
      { ...SESSION, accountName: '<img src=x onerror="alert(1)">' },
      "csrf",
      [{ ...DRAFT, title: "<script>alert(1)</script>", repoOrg: 'name" onclick="alert(1)' }],
    );

    expect(rendered).not.toContain("<script>alert(1)</script>");
    expect(rendered).not.toContain("<img src=x");
    expect(rendered).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(rendered).toContain("name%22%20onclick%3D%22alert(1)");
  });

  test("renders future file kinds through the separated version descriptor", () => {
    const detail: DraftDetailResponse = {
      ok: true,
      draft: DRAFT,
      versions: [
        {
          versionId: "version_render",
          versionNumber: 3,
          createdAt: "2026-08-13T16:07:00.000Z",
          publicUrl: "https://nok4tarxkb27.pushover.example/v/3",
          rawUrl: "https://nok4tarxkb27.pushover.example/v/3/raw",
          file: {
            fileId: "file_render",
            filename: "plan.pdf",
            byteSize: 2048,
            sha256: "a".repeat(64),
            content: { kind: "pdf", mediaType: "application/pdf" },
          },
          metadata: {
            gitBranch: null,
            gitCommitSha: null,
            gitCommitSubject: null,
            gitDirty: null,
            cliVersion: null,
            ciProvider: null,
            ciRunUrl: null,
            ciActor: null,
          },
        },
      ],
    };

    const rendered = renderDraftDetail(SESSION, "csrf", detail);

    expect(rendered).toContain("plan.pdf · PDF · 2.0 KB");
    expect(rendered).toContain('aria-current="page" href="/drafts"');
  });

  test("marks CLI setup as active without changing the protected forms", () => {
    const rendered = renderCliAuth(SESSION, "csrf-value", []);

    expect(rendered).toContain('aria-current="page" href="/cli/auth"');
    expect(rendered).toContain('method="post" action="/cli/auth/keys"');
    expect(rendered).toContain('name="csrf" value="csrf-value"');
  });

  test("aligns the navigation shell and hides the email until interaction", () => {
    const rendered = renderDrafts(SESSION, "csrf", []);

    expect(rendered).toContain('class="account-email" tabindex="0"');
    expect(rendered).toContain("filter:blur(4px)");
    expect(rendered).toContain(".site-header-inner{min-height:62px;width:min(100% - 40px,1050px)");
  });
});
