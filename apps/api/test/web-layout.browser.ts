import { expect, test, type Locator } from "@playwright/test";
import type { DraftDetailResponse, DraftSummary } from "@pushdraft/contracts";

import type { WebSession } from "../src/auth/session";
import { renderCliAuth, renderDraftDetail, renderDrafts } from "../src/web/render";

const DRAFT: DraftSummary = {
  draftId: "abcdefghijkl",
  title: "A".repeat(128),
  description: "D".repeat(256),
  repoOrg: "AnOrganizationWithALongName",
  repoName: "ARepositoryWithALongName",
  repoHost: "github.com",
  latestVersionNumber: 1,
  versionCount: 1,
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
  latestVersionAt: "2026-09-01T12:00:00.000Z",
  disabled: false,
  publicUrl: "https://abcdefghijkl.pushdraft.example",
  rawUrl: "https://abcdefghijkl.pushdraft.example/raw",
};

const DETAIL: DraftDetailResponse = {
  ok: true,
  draft: DRAFT,
  versions: [
    {
      versionId: "version_layout",
      versionNumber: 1,
      createdAt: DRAFT.createdAt,
      publicUrl: `${DRAFT.publicUrl}/v/1`,
      rawUrl: `${DRAFT.publicUrl}/v/1/raw`,
      file: {
        fileId: "file_layout",
        filename: `${"LongFilename".repeat(20)}.html`,
        byteSize: 1024,
        sha256: "a".repeat(64),
        content: { kind: "html", mediaType: "text/html" },
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

for (const width of [320, 375, 1050]) {
  for (const accountName of ["Alexander Theodosius Example", "A".repeat(128)]) {
    const session: WebSession = {
      id: "session_layout",
      accountId: "account_layout",
      accountName,
      email: `${"long".repeat(15)}@${"example".repeat(20)}.com`,
      pictureUrl: null,
      csrfTokenHash: "hash",
    };
    const pages = {
      list: renderDrafts(session, "csrf", [DRAFT]),
      detail: renderDraftDetail(session, "csrf", DETAIL),
      cli: renderCliAuth(session, "csrf", []),
    };

    for (const [name, html] of Object.entries(pages)) {
      test(`${name} fits ${width}px with ${accountName.length}-character account name`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.setContent(html);

        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        await expect(page.locator(".account-name")).toHaveText(accountName);
        await expect(page.locator(".account-name")).toHaveAttribute("title", accountName);
        await expect(page.locator(".account")).toHaveAttribute(
          "aria-label",
          `Signed in as ${accountName}, ${session.email}`,
        );

        for (const control of [
          page.getByRole("link", { name: "pushdraft home" }),
          page.getByRole("navigation").getByRole("link", { name: "My drafts", exact: true }),
          page.getByRole("navigation").getByRole("link", { name: "CLI setup", exact: true }),
          page.getByRole("button", { name: "Sign out" }),
        ]) {
          await control.click({ trial: true });
          await control.focus();
          await expect(control).toBeFocused();
        }

        await expectNoOverlap(page.locator(".brand"), page.locator(".account"));
        await expectNoOverlap(page.locator(".account"), page.locator(".sign-out"));
        await expectNoOverlap(page.locator(".account"), page.getByRole("navigation"));
        if (name === "list") {
          await expectNoOverlap(
            page.locator(".repository-heading h2"),
            page.locator(".repository-link"),
          );
          await expectNoOverlap(page.locator(".repository-heading"), page.locator(".draft-list"));
        }
        if (name === "detail") {
          await expect(page.locator("h1")).toHaveText(DRAFT.title);
          await expectNoOverlap(page.locator("h1"), page.locator(".detail-heading .lede"));
        }
      });
    }
  }
}

async function expectNoOverlap(first: Locator, second: Locator): Promise<void> {
  const a = (await first.boundingBox())!;
  const b = (await second.boundingBox())!;
  expect(a.width).toBeGreaterThan(0);
  expect(b.width).toBeGreaterThan(0);
  const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  expect(overlapWidth <= 0 || overlapHeight <= 0).toBe(true);
}
