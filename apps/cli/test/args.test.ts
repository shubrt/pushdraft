import { describe, expect, test } from "bun:test";

import { parseCliArgs } from "../src/args.js";

describe("parseCliArgs", () => {
  test("parses upload options", () => {
    expect(
      parseCliArgs([
        "upload",
        "plan.html",
        "--draft",
        "draft_123",
        "--description",
        "Launch plan",
        "--api-url",
        "https://pushover.example",
      ]),
    ).toEqual({
      kind: "upload",
      file: "plan.html",
      draftId: "draft_123",
      forceNew: false,
      description: "Launch plan",
      apiUrl: "https://pushover.example",
    });
  });

  test("parses the new-draft flag", () => {
    expect(parseCliArgs(["upload", "plan.html", "--new"])).toMatchObject({
      kind: "upload",
      file: "plan.html",
      forceNew: true,
    });
  });

  test("parses auth and list commands", () => {
    expect(parseCliArgs(["auth", "set", "pushover_secret"])).toMatchObject({
      kind: "auth-set",
      apiKey: "pushover_secret",
    });
    expect(parseCliArgs(["list", "--json"])).toMatchObject({ kind: "list", json: true });
  });

  test("rejects missing and extra positional arguments", () => {
    expect(() => parseCliArgs(["upload"])).toThrow("Missing file");
    expect(() => parseCliArgs(["whoami", "extra"])).toThrow("Unexpected argument");
  });
});
