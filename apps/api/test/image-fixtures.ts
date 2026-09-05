import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";

// Complete 2x2 images with red, green, blue, and yellow pixels.
export const PNG = readFileSync(new URL("./fixtures/pixels.png", import.meta.url));
export const JPEG = readFileSync(new URL("./fixtures/pixels.jpeg", import.meta.url));
export const WEBP = readFileSync(new URL("./fixtures/pixels.webp", import.meta.url));
export const ANIMATED_WEBP = readFileSync(new URL("./fixtures/animated.webp", import.meta.url));
export const IMAGE_FIXTURES = [
  ["image/png", PNG],
  ["image/jpeg", JPEG],
  ["image/webp", WEBP],
  ["image/webp", ANIMATED_WEBP],
] as const;

export const CORRUPT_IMAGE_FIXTURES = IMAGE_FIXTURES.map(([mediaType, original]) => {
  const bytes = Buffer.from(original);
  if (mediaType === "image/png") {
    const chunk = bytes.indexOf("IDAT");
    const end = chunk + 4 + bytes.readUInt32BE(chunk - 4);
    bytes.fill(0, chunk + 4, end);
    // Keep the chunk checksum valid to exercise pixel decoding, not CRC validation.
    bytes.writeUInt32BE(crc32(bytes.subarray(chunk, end)), end);
  } else if (mediaType === "image/jpeg") {
    const scan = bytes.indexOf(Buffer.from([0xff, 0xda]));
    bytes.fill(0xff, scan + 2 + bytes.readUInt16BE(scan + 2), bytes.length - 2);
  } else {
    // Damage the final frame, so animated validation must read more than frame one.
    const chunk = bytes.lastIndexOf("VP8 ");
    bytes.fill(0xff, chunk + 18, chunk + 8 + bytes.readUInt32LE(chunk + 4));
  }
  return [mediaType, bytes] as const;
});
