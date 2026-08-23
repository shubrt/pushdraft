import { afterEach, describe, expect, test } from "vite-plus/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readReferencesManifest } from "../src/references-manifest.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("references manifest", () => {
  test("resolves image paths relative to the manifest and sorts reference names", () => {
    const directory = makeTemporaryDirectory();
    const manifest = path.join(directory, "config", "pushdraft.assets.json");
    fs.mkdirSync(path.dirname(manifest));
    fs.writeFileSync(
      manifest,
      JSON.stringify({ logo: "../images/logo.png", hero: "../images/hero.webp" }),
    );

    expect(readReferencesManifest(manifest)).toEqual([
      { name: "hero", filename: path.join(directory, "images", "hero.webp") },
      { name: "logo", filename: path.join(directory, "images", "logo.png") },
    ]);
  });

  test("rejects empty manifests, invalid names, and non-string paths", () => {
    const directory = makeTemporaryDirectory();
    const manifest = path.join(directory, "pushdraft.assets.json");

    fs.writeFileSync(manifest, "{}");
    expect(() => readReferencesManifest(manifest)).toThrow("cannot be empty");

    fs.writeFileSync(manifest, JSON.stringify({ Hero: "hero.png" }));
    expect(() => readReferencesManifest(manifest)).toThrow('Invalid reference name "Hero"');

    fs.writeFileSync(manifest, JSON.stringify({ hero: 42 }));
    expect(() => readReferencesManifest(manifest)).toThrow("non-empty image path");
  });
});

function makeTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pushdraft-manifest-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
