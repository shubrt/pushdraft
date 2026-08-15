import { describe, expect, test } from "vite-plus/test";

import { collectCiMetadata, parseRemote, sha256 } from "../src/metadata.js";

describe("parseRemote", () => {
  test("parses scp-style GitHub remotes", () => {
    expect(parseRemote("git@github.com:shubrt/pushdraft.git")).toEqual({
      host: "github.com",
      org: "shubrt",
      name: "pushdraft",
    });
  });

  test("parses https and ssh URLs", () => {
    expect(parseRemote("https://github.com/shubrt/pushdraft.git")).toEqual({
      host: "github.com",
      org: "shubrt",
      name: "pushdraft",
    });
    expect(parseRemote("ssh://git@gitlab.example/team/pushdraft.git")).toEqual({
      host: "gitlab.example",
      org: "team",
      name: "pushdraft",
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
        GITHUB_REPOSITORY: "shubrt/pushdraft",
        GITHUB_RUN_ID: "42",
        GITHUB_ACTOR: "shubrt",
      }),
    ).toEqual({
      ciProvider: "github_actions",
      ciRunUrl: "https://github.com/shubrt/pushdraft/actions/runs/42",
      ciActor: "shubrt",
    });
  });

  test("marks other CI systems without guessing a provider", () => {
    expect(collectCiMetadata({ CI: "true" })).toEqual({ ciProvider: "unknown" });
    expect(collectCiMetadata({})).toEqual({});
  });
});

test("sha256 hashes UTF-8 content", () => {
  expect(sha256("pushdraft")).toBe(
    "0c4f96dd9fe0b95f1d3a98b7d181ebb0cef2c27c7691cea96cf750febbb75286",
  );
});
