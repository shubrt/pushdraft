import { describe, expect, test } from "bun:test";

import { collectCiMetadata, parseRemote, sha256 } from "../src/metadata.js";

describe("parseRemote", () => {
  test("parses scp-style GitHub remotes", () => {
    expect(parseRemote("git@github.com:shubrt/pp.git")).toEqual({
      host: "github.com",
      org: "shubrt",
      name: "pp",
    });
  });

  test("parses https and ssh URLs", () => {
    expect(parseRemote("https://github.com/shubrt/pp.git")).toEqual({
      host: "github.com",
      org: "shubrt",
      name: "pp",
    });
    expect(parseRemote("ssh://git@gitlab.example/team/pp.git")).toEqual({
      host: "gitlab.example",
      org: "team",
      name: "pp",
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
        GITHUB_REPOSITORY: "shubrt/pp",
        GITHUB_RUN_ID: "42",
        GITHUB_ACTOR: "shubrt",
      }),
    ).toEqual({
      ciProvider: "github_actions",
      ciRunUrl: "https://github.com/shubrt/pp/actions/runs/42",
      ciActor: "shubrt",
    });
  });

  test("marks other CI systems without guessing a provider", () => {
    expect(collectCiMetadata({ CI: "true" })).toEqual({ ciProvider: "unknown" });
    expect(collectCiMetadata({})).toEqual({});
  });
});

test("sha256 hashes UTF-8 content", () => {
  expect(sha256("pp")).toBe("d53315bea08cec50d2591fcaf3b32dc5d289cdc6c16b7e8bed8c8e3f7ceaa34e");
});
