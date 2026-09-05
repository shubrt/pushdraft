import { describe, expect, test } from "vite-plus/test";

import { validateImage } from "../src/drafts/image-policy";

import {
  CORRUPT_IMAGE_FIXTURES,
  IMAGE_FIXTURES,
  JPEG,
  PNG,
  OVERSIZED_PNG,
  OVERSIZED_ANIMATION,
} from "./image-fixtures";

describe("raster image validation", () => {
  test.each(IMAGE_FIXTURES)("accepts complete %s bytes", async (mediaType, bytes) => {
    expect(await validateImage(bytes.toString("base64"), mediaType, 1024)).toEqual({
      ok: true,
      bytes,
    });
  });

  test("preserves JPEG application data after the end-of-image marker", async () => {
    const bytes = Buffer.concat([JPEG, Buffer.from("trailing application data")]);
    expect(await validateImage(bytes.toString("base64"), "image/jpeg", 1024)).toEqual({
      ok: true,
      bytes,
    });
  });

  test.each(IMAGE_FIXTURES)("rejects every truncated prefix of %s", async (mediaType, bytes) => {
    for (let length = 1; length < bytes.length; length++) {
      const result = await validateImage(
        bytes.subarray(0, length).toString("base64"),
        mediaType,
        1024,
      );
      expect(result.ok, `${mediaType} prefix of ${length} bytes`).toBe(false);
    }
  });

  test.each(CORRUPT_IMAGE_FIXTURES)(
    "rejects corrupt %s pixel data with intact framing",
    async (mediaType, bytes) => {
      expect(await validateImage(bytes.toString("base64"), mediaType, 1024)).toEqual({
        ok: false,
        errors: [`Image file is not a complete, decodable ${mediaType} image.`],
      });
    },
  );

  test("rejects a PNG with an out-of-bounds chunk length", async () => {
    const bytes = Buffer.from(PNG);
    bytes.writeUInt32BE(0xffffffff, 8);
    expect((await validateImage(bytes.toString("base64"), "image/png", 1024)).ok).toBe(false);
  });

  test("rejects a damaged PNG trailer checksum even if its pixels decode", async () => {
    const bytes = Buffer.from(PNG);
    bytes[bytes.length - 1] = bytes.at(-1)! ^ 1;
    expect((await validateImage(bytes.toString("base64"), "image/png", 1024)).ok).toBe(false);
  });

  test.each([
    ["image/png", OVERSIZED_PNG],
    ["image/webp", OVERSIZED_ANIMATION],
  ] as const)(
    "bounds decoded pixels for %s including all animation frames",
    async (mediaType, bytes) => {
      expect(bytes.length).toBeLessThan(512 * 1024);
      expect(await validateImage(bytes.toString("base64"), mediaType, 512 * 1024)).toEqual({
        ok: false,
        errors: ["Image exceeds the limit of 16777216 decoded pixels."],
      });
    },
  );

  test("rejects malformed base64", async () => {
    expect(await validateImage("not base64", "image/png", 1024)).toEqual({
      ok: false,
      errors: ["Image content is not valid base64."],
    });
  });

  test("rejects mismatched media types", async () => {
    expect(await validateImage(PNG.toString("base64"), "image/jpeg", 1024)).toEqual({
      ok: false,
      errors: ["Image bytes do not match declared media type image/jpeg."],
    });
  });

  test("enforces the configured byte limit after decoding", async () => {
    expect(await validateImage(PNG.toString("base64"), "image/png", PNG.byteLength - 1)).toEqual({
      ok: false,
      errors: [`Image file is ${PNG.byteLength} bytes; maximum is ${PNG.byteLength - 1} bytes.`],
    });
  });
});
