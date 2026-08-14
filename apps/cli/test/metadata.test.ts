import { describe, expect, test } from "vite-plus/test";

import { collectCiMetadata, parseRemote, sha256 } from "../src/metadata.js";

describe("parseRemote", () => {
  test("parses scp-style GitHub remotes", () => {
    expect(parseRemote("git@github.com:shubrt/pushover.git")).toEqual({
      host: "github.com",
      org: "shubrt",
      name: "pushover",
    });
  });

  test("parses https and ssh URLs", () => {
    expect(parseRemote("https://github.com/shubrt/pushover.git")).toEqual({
      host: "github.com",
      org: "shubrt",
      name: "pushover",
    });
    expect(parseRemote("ssh://git@gitlab.example/team/pushover.git")).toEqual({
      host: "gitlab.example",
      org: "team",
      name: "pushover",
    });
  });

  test("returns no metadata for a missing remote", () => {
    expect(parseRemote(null)).toEqual({});
  });
});

describe("collectCiMetadata", () => {
  test("builds a GitHub Actions run URL", () => {
    expect(
      collectCiMetadata({
        GITHUB_ACTIONS: "true",
        GITHUB_REPOSITORY: "shubrt/pushover",
        GITHUB_RUN_ID: "42",
        GITHUB_ACTOR: "shubrt",
      }),
    ).toEqual({
      ciProvider: "github_actions",
      ciRunUrl: "https://github.com/shubrt/pushover/actions/runs/42",
      ciActor: "shubrt",
    });
  });

  test("marks other CI systems without guessing a provider", () => {
    expect(collectCiMetadata({ CI: "true" })).toEqual({ ciProvider: "unknown" });
    expect(collectCiMetadata({})).toEqual({});
  });
});

test("sha256 hashes UTF-8 content", () => {
  expect(sha256("pushover")).toBe(
    "bf9f9d1b7f006b1e58ef724fe380a7b2b6d9b36ec1293318698f7b7d39c3dadd",
  );
});
