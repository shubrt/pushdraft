import { describe, expect, test } from "vite-plus/test";

import { validateImage } from "../src/drafts/image-policy";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

describe("raster image validation", () => {
  test.each([
    ["image/png", PNG],
    ["image/jpeg", JPEG],
    ["image/webp", WEBP],
  ] as const)("accepts %s bytes", (mediaType, bytes) => {
    expect(validateImage(bytes.toString("base64"), mediaType, 1024)).toEqual({
      ok: true,
      bytes,
    });
  });

  test("rejects malformed base64", () => {
    expect(validateImage("not base64", "image/png", 1024)).toEqual({
      ok: false,
      errors: ["Image content is not valid base64."],
    });
  });

  test("rejects mismatched media types", () => {
    expect(validateImage(PNG.toString("base64"), "image/jpeg", 1024)).toEqual({
      ok: false,
      errors: ["Image bytes do not match declared media type image/jpeg."],
    });
  });

  test("enforces the configured byte limit after decoding", () => {
    expect(validateImage(PNG.toString("base64"), "image/png", PNG.byteLength - 1)).toEqual({
      ok: false,
      errors: [`Image file is ${PNG.byteLength} bytes; maximum is ${PNG.byteLength - 1} bytes.`],
    });
  });
});
