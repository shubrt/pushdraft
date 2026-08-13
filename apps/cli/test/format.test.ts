import { describe, expect, test } from "bun:test";

import { formatDrafts, timeAgo } from "../src/format.js";

describe("timeAgo", () => {
  const now = Date.parse("2026-08-13T12:00:00.000Z");

  test("uses the largest whole unit", () => {
    expect(timeAgo("2026-08-13T10:00:00.000Z", now)).toBe("2 hours ago");
    expect(timeAgo("2026-08-13T11:59:40.000Z", now)).toBe("just now");
  });

  test("handles invalid values", () => {
    expect(timeAgo(undefined, now)).toBe("unknown");
    expect(timeAgo("not-a-date", now)).toBe("unknown");
  });
});

test("formatDrafts includes repository, version, URL, and description", () => {
  const now = Date.parse("2026-08-13T12:00:00.000Z");
  expect(
    formatDrafts(
      [
        {
          draftId: "q43kvvtxix1x",
          title: "Private postplan",
          description: "Implementation plan",
          repoOrg: "shubrt",
          repoName: "pp",
          repoHost: "github.com",
          latestVersionNumber: 2,
          versionCount: 2,
          createdAt: "2026-08-13T10:00:00.000Z",
          updatedAt: "2026-08-13T11:00:00.000Z",
          latestVersionAt: "2026-08-13T11:00:00.000Z",
          disabled: false,
          publicUrl: "https://draft_123.pp.example",
          rawUrl: "https://draft_123.pp.example/raw",
        },
      ],
      now,
    ),
  ).toContain("shubrt/pp · v2 · 2 versions · updated 1 hour ago");
});
