import { describe, expect, test } from "vite-plus/test";
import type { DraftDetailResponse, DraftSummary } from "@pushdraft/contracts";

import type { WebSession } from "../src/auth/session";
import {
  renderCliAuth,
  renderDraftDetail,
  renderDraftShareBridge,
  renderDraftShareCreated,
  renderDraftShareForm,
  renderDraftShareReady,
  renderDraftShareUnavailable,
  renderDrafts,
} from "../src/web/render";

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
  repoName: "pushdraft",
  repoHost: "github.com",
  latestVersionNumber: 3,
  versionCount: 3,
  createdAt: "2026-08-13T11:22:00.000Z",
  updatedAt: "2026-08-13T16:07:00.000Z",
  latestVersionAt: "2026-08-13T16:07:00.000Z",
  disabled: false,
  publicUrl: "https://nok4tarxkb27.pushdraft.example",
  rawUrl: "https://nok4tarxkb27.pushdraft.example/raw",
};

const DETAIL: DraftDetailResponse = {
  ok: true,
  draft: DRAFT,
  versions: [
    {
      versionId: "version_render",
      versionNumber: 3,
      createdAt: "2026-08-13T16:07:00.000Z",
      publicUrl: "https://nok4tarxkb27.pushdraft.example/v/3",
      rawUrl: "https://nok4tarxkb27.pushdraft.example/v/3/raw",
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

describe("web rendering", () => {
  test("renders direction A with the lime accent and active draft navigation", () => {
    const rendered = renderDrafts(SESSION, "csrf", [DRAFT]);

    expect(rendered).toContain("--black:#000");
    expect(rendered).toContain("--accent:#dfff00");
    expect(rendered).not.toContain("#1d4ed8");
    expect(rendered).toContain('class="active" aria-current="page" href="/drafts"');
    expect(rendered).toContain('href="https://github.com/shubrt/pushdraft"');
    expect(rendered).toContain("v3");
    expect(rendered).toContain("3 versions");
  });

  test.each([false, true])(
    "separates repository hosts regardless of input order, reversed=%s",
    (reverse) => {
      const githubDraft = { ...DRAFT, repoOrg: "acme", repoName: "product", title: "GitHub draft" };
      const gitlabDraft = { ...githubDraft, repoHost: "gitlab.com", title: "GitLab draft" };
      const drafts = [githubDraft, gitlabDraft, { ...githubDraft, title: "Another GitHub draft" }];
      const rendered = renderDrafts(SESSION, "csrf", reverse ? drafts.reverse() : drafts);
      const sections = rendered.match(/<section class="repository-section">[\s\S]*?<\/section>/g)!;

      expect(sections).toHaveLength(2);
      const github = sections.find((section) => section.includes("github.com/acme/product</h2>"))!;
      const gitlab = sections.find((section) => section.includes("gitlab.com/acme/product</h2>"))!;
      expect(github).toContain("GitHub draft");
      expect(github).toContain("Another GitHub draft");
      expect(github).not.toContain("GitLab draft");
      expect(github).toContain('href="https://github.com/acme/product"');
      expect(gitlab).toContain("GitLab draft");
      expect(gitlab).not.toContain("GitHub draft");
      expect(gitlab).not.toContain('href="https://github.com/');
    },
  );

  test("keeps unknown repository hosts separate and groups drafts without repository metadata", () => {
    const rendered = renderDrafts(SESSION, "csrf", [
      DRAFT,
      { ...DRAFT, repoHost: null, title: "Unknown host draft" },
      { ...DRAFT, repoOrg: null, repoName: null, repoHost: null, title: "No metadata" },
      { ...DRAFT, repoOrg: null, repoName: null, repoHost: "gitlab.com", title: "Host only" },
    ]);
    const sections = rendered.match(/<section class="repository-section">[\s\S]*?<\/section>/g)!;

    expect(sections).toHaveLength(3);
    const unknown = sections.find((section) => section.includes("Unknown host/"))!;
    expect(unknown).toContain("Unknown host draft");
    expect(unknown).not.toContain('class="repository-link"');
    const ungrouped = sections.find((section) => section.includes("No repository</h2>"))!;
    expect(ungrouped).toContain("No metadata");
    expect(ungrouped).toContain("Host only");
    expect(ungrouped).not.toContain('class="repository-link"');
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
    const rendered = renderDraftDetail(SESSION, "csrf", DETAIL);

    expect(rendered).toContain("plan.pdf · PDF · 2.0 KB");
    expect(rendered).toContain('aria-current="page" href="/drafts"');
  });

  test("renders active share links with exact expiry and protected revoke forms", () => {
    const rendered = renderDraftDetail(SESSION, 'csrf"><script>alert(1)</script>', DETAIL, [
      {
        id: 'share/id"',
        draftId: DRAFT.draftId,
        versionNumber: 3,
        createdAt: "2026-09-01T12:30:00.000Z",
        expiresAt: "2026-09-08T12:30:00.000Z",
      },
    ]);

    expect(rendered).toContain(`href="/drafts/${DRAFT.draftId}/share"`);
    expect(rendered).toContain("Share links");
    expect(rendered).toContain("1 active");
    expect(rendered).toContain("v3");
    expect(rendered).toContain('datetime="2026-09-08T12:30:00.000Z"');
    expect(rendered).toContain("08 Sep 2026 · 12:30 UTC");
    expect(rendered).toContain(
      `method="post" action="/drafts/${DRAFT.draftId}/shares/share%2Fid%22/revoke"`,
    );
    expect(rendered).toContain(
      'name="csrf" value="csrf&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"',
    );
    expect(rendered).not.toContain("<script>alert(1)</script>");
  });

  test("renders the share form with bounded TTL choices and seven days selected", () => {
    const rendered = renderDraftShareForm(SESSION, "csrf-value", DETAIL);

    expect(rendered).toContain(`method="post" action="/drafts/${DRAFT.draftId}/shares"`);
    expect(rendered).toContain('name="csrf" value="csrf-value"');
    expect(rendered).toContain('name="ttlSeconds"');
    expect(rendered).toContain('<option value="3600">1 hour</option>');
    expect(rendered).toContain('<option value="86400">1 day</option>');
    expect(rendered).toContain('<option value="604800" selected>7 days</option>');
    expect(rendered).toContain('<option value="2592000">30 days</option>');
    expect(rendered).toContain("v3 · current version");
  });

  test("shows a newly created share URL once with a nonce-protected copy enhancement", () => {
    const url = "https://pushdraft.example/s/share-token";
    const rendered = renderDraftShareCreated(
      SESSION,
      "csrf-value",
      {
        id: "share_render",
        draftId: DRAFT.draftId,
        versionNumber: 3,
        createdAt: "2026-09-01T12:30:00.000Z",
        expiresAt: "2026-09-08T12:30:00.000Z",
        token: "share-token",
        url,
      },
      'nonce"><script>alert(1)</script>',
    );

    expect(rendered.match(new RegExp(url, "g"))).toHaveLength(1);
    expect(rendered).toContain(`id="share-url" type="url" value="${url}" readonly`);
    expect(rendered).toContain('id="copy-share-link" type="button" hidden');
    expect(rendered).toContain('role="status" aria-live="polite"');
    expect(rendered).toContain("navigator.clipboard.writeText(input.value)");
    expect(rendered).toContain('nonce="nonce&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(rendered).not.toContain("<script>alert(1)</script>");
    expect(rendered).toContain("08 Sep 2026 · 12:30 UTC");
  });

  test("renders the public share exchange, ready, and unavailable states", () => {
    const bridge = renderDraftShareBridge(
      'https://nok4tarxkb27.pushdraft.example/_share/exchange?x="',
      'ticket"><img src=x>',
      "nonce-value",
    );
    const ready = renderDraftShareReady('/v/3/</script><script>alert("x")</script>', "nonce-value");
    const unavailable = renderDraftShareUnavailable("https://pushdraft.example");

    expect(bridge).toContain('id="share-bridge" method="post"');
    expect(bridge).toContain('history.replaceState(null,"","/share")');
    expect(bridge).toContain('name="ticket" value="ticket&quot;&gt;&lt;img src=x&gt;"');
    expect(bridge).toContain("requestSubmit()");
    expect(ready).toContain(
      'window.location.replace("/v/3/\\u003c/script>\\u003cscript>alert(\\"x\\")\\u003c/script>")',
    );
    expect(ready).not.toContain('</script><script>alert("x")</script>');
    expect(unavailable).toContain("This link is unavailable.");
    expect(unavailable).toContain("expired or the owner revoked it");
    expect(unavailable).toContain('href="https://pushdraft.example/"');
    expect(unavailable).toContain('href="https://pushdraft.example/drafts"');
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
