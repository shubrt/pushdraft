import { describe, expect, test } from "vite-plus/test";

import { parseCliArgs } from "../src/args.js";

describe("parseCliArgs", () => {
  test("uses the published command name in help", () => {
    expect(parseCliArgs(["--help"])).toMatchObject({
      kind: "help",
      text: expect.stringContaining("Usage: pushdraft <command>"),
    });
  });

  test("parses upload options", () => {
    expect(
      parseCliArgs([
        "upload",
        "plan.html",
        "--draft",
        "draft_123",
        "--description",
        "Launch plan",
        "--ref",
        "hero-image=q43kvvtxix1x",
        "--ref",
        "chart=abc123def456",
        "--refs-file",
        "pushdraft.assets.json",
        "--api-url",
        "https://pushdraft.example",
      ]),
    ).toEqual({
      kind: "upload",
      file: "plan.html",
      draftId: "draft_123",
      forceNew: false,
      description: "Launch plan",
      references: {
        "hero-image": "q43kvvtxix1x",
        chart: "abc123def456",
      },
      referencesFile: "pushdraft.assets.json",
      apiUrl: "https://pushdraft.example",
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
    expect(parseCliArgs(["auth", "set", "pushdraft_secret"])).toMatchObject({
      kind: "auth-set",
      apiKey: "pushdraft_secret",
    });
    expect(parseCliArgs(["list", "--json"])).toMatchObject({ kind: "list", json: true });
  });

  test("rejects missing and extra positional arguments", () => {
    expect(() => parseCliArgs(["upload"])).toThrow("Missing file");
    expect(() => parseCliArgs(["whoami", "extra"])).toThrow("Unexpected argument");
  });

  test("rejects malformed and duplicate references", () => {
    expect(() => parseCliArgs(["upload", "plan.html", "--ref", "Hero=q43kvvtxix1x"])).toThrow(
      "Invalid reference",
    );
    expect(() => parseCliArgs(["upload", "plan.html", "--ref", "hero=short"])).toThrow(
      "Invalid reference",
    );
    expect(() =>
      parseCliArgs([
        "upload",
        "plan.html",
        "--ref",
        "hero=q43kvvtxix1x",
        "--ref",
        "hero=abc123def456",
      ]),
    ).toThrow("Duplicate reference name: hero");
  });

  test("lists supported upload files and the reference option in help", () => {
    const command = parseCliArgs(["upload", "--help"]);
    expect(command).toMatchObject({ kind: "help" });
    if (command.kind !== "help") throw new Error("Expected upload help.");
    expect(command.text).toContain("--ref <name=id>");
    expect(command.text).toContain("--refs-file <path>");
    expect(command.text).toContain('{"hero":"./images/hero.webp"');
    expect(command.text).toContain(".png, .jpg, .jpeg, .webp");
  });
});
