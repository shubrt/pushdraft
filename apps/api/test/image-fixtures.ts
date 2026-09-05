import { readFileSync } from "node:fs";
import { crc32 } from "node:zlib";

// Complete 2x2 images with red, green, blue, and yellow pixels.
export const PNG = readFileSync(new URL("./fixtures/pixels.png", import.meta.url));
export const JPEG = readFileSync(new URL("./fixtures/pixels.jpeg", import.meta.url));
export const WEBP = readFileSync(new URL("./fixtures/pixels.webp", import.meta.url));
export const ANIMATED_WEBP = readFileSync(new URL("./fixtures/animated.webp", import.meta.url));
export const ANIMATED_PNG = readFileSync(new URL("./fixtures/animated.png", import.meta.url));
export const CORRUPT_ANIMATED_PNG = corruptPngPixels(ANIMATED_PNG, "fdAT");
export const OVERSIZED_PNG = readFileSync(new URL("./fixtures/oversized.png", import.meta.url));
export const OVERSIZED_ANIMATION = readFileSync(
  new URL("./fixtures/oversized-animation.webp", import.meta.url),
);
export const IMAGE_FIXTURES = [
  ["image/png", PNG],
  ["image/jpeg", JPEG],
  ["image/webp", WEBP],
  ["image/webp", ANIMATED_WEBP],
] as const;

export const CORRUPT_IMAGE_FIXTURES = IMAGE_FIXTURES.map(([mediaType, original]) => {
  const bytes = Buffer.from(original);
  if (mediaType === "image/png") {
    return [mediaType, corruptPngPixels(original, "IDAT")] as const;
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

function corruptPngPixels(original: Buffer, type: "IDAT" | "fdAT"): Buffer {
  const bytes = Buffer.from(original);
  const chunk = bytes.indexOf(type);
  const end = chunk + 4 + bytes.readUInt32BE(chunk - 4);
  // fdAT starts with a frame sequence number, followed by compressed pixels.
  bytes.fill(0, chunk + (type === "fdAT" ? 8 : 4), end);
  // Keep the checksum valid so corruption reaches the pixel decoder.
  bytes.writeUInt32BE(crc32(bytes.subarray(chunk, end)), end);
  return bytes;
}
