import { describe, expect, test } from "vite-plus/test";

import { createApp } from "../src/app";
import { TEST_CONFIG, TEST_DRAFT_ID, createFakeDatabase, unexpectedQuery } from "./helpers";

describe("not-found navigation", () => {
  test.each([
    "https://pushdraft.example",
    "https://pr-18.preview.pushdraft.example",
    "http://localhost:3003",
  ])("links to the configured application origin %s", async (origin) => {
    const publicUrl = new URL(origin);
    const draftUrl = new URL(publicUrl);
    draftUrl.hostname = `${TEST_DRAFT_ID}.${publicUrl.hostname}`;
    const app = createApp({
      config: { ...TEST_CONFIG, publicUrl },
      database: createFakeDatabase(unexpectedQuery),
    });

    for (const url of [
      new URL("/missing", publicUrl),
      new URL("/missing", draftUrl),
      new URL("/drafts", draftUrl),
      new URL("/cli/auth", draftUrl),
    ]) {
      const response = await app.handle(new Request(url));
      const body = await response.text();
      expect(response.status).toBe(404);
      const links = [...body.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(
        ([, href, label]) => ({ label, target: new URL(href!, url).href }),
      );
      expect(links).toEqual([
        { label: "pushdraft", target: `${origin}/` },
        { label: "My drafts", target: `${origin}/drafts` },
        { label: "CLI setup", target: `${origin}/cli/auth` },
        { label: "Return home", target: `${origin}/` },
      ]);
    }
  });
});
