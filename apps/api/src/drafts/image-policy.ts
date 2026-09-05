import type { RasterImageMediaType } from "@pushdraft/contracts";
import sharp from "sharp";

// Bound raw decode output to 64 MiB for RGBA, including all animation frames.
const MAX_DECODED_PIXELS = 16_777_216;

const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

export type ImageValidation = { ok: true; bytes: Buffer } | { ok: false; errors: string[] };

export async function validateImage(
  base64: string,
  mediaType: RasterImageMediaType,
  maxBytes: number,
): Promise<ImageValidation> {
  const bytes = decodeBase64(base64);
  if (!bytes) return { ok: false, errors: ["Image content is not valid base64."] };
  if (bytes.byteLength === 0) return { ok: false, errors: ["Image file is empty."] };

  const errors: string[] = [];
  if (bytes.byteLength > maxBytes) {
    errors.push(`Image file is ${bytes.byteLength} bytes; maximum is ${maxBytes} bytes.`);
  }
  if (!matchesMediaType(bytes, mediaType)) {
    errors.push(`Image bytes do not match declared media type ${mediaType}.`);
  }

  if (errors.length > 0) return { ok: false, errors };

  try {
    if (!hasCompleteContainer(bytes, mediaType)) throw new Error("Incomplete image container.");
    // Decode every pixel and animated WebP frame; metadata only inspects headers.
    // Some decoder warnings do not reject the promise, even with failOn set.
    let warned = false;
    const image = sharp(bytes, {
      failOn: "warning",
      animated: true,
      limitInputPixels: MAX_DECODED_PIXELS,
    });
    await image
      .on("warning", () => {
        warned = true;
      })
      .raw()
      .toBuffer();
    if (warned) throw new Error("Image decoder reported corrupt data.");
    return { ok: true, bytes };
  } catch (error) {
    if (error instanceof Error && error.message === "Input image exceeds pixel limit") {
      return {
        ok: false,
        errors: [`Image exceeds the limit of ${MAX_DECODED_PIXELS} decoded pixels.`],
      };
    }
    return { ok: false, errors: [`Image file is not a complete, decodable ${mediaType} image.`] };
  }
}

function decodeBase64(value: string): Buffer | null {
  if (value.length === 0 || value.length % 4 !== 0) return null;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return null;
  }

  const bytes = Buffer.from(value, "base64");
  return bytes.toString("base64") === value ? bytes : null;
}

function matchesMediaType(bytes: Uint8Array, mediaType: RasterImageMediaType): boolean {
  switch (mediaType) {
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/webp":
      return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && at(bytes, 8, [0x57, 0x45, 0x42, 0x50]);
  }
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return at(bytes, 0, signature);
}

function at(bytes: Uint8Array, offset: number, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function hasCompleteContainer(bytes: Buffer, mediaType: RasterImageMediaType): boolean {
  if (mediaType === "image/jpeg") {
    // JPEG readers allow application data after the end-of-image marker.
    return bytes.includes(Buffer.from([0xff, 0xd9]), 2);
  }
  if (mediaType === "image/webp") {
    if (bytes.readUInt32LE(4) !== bytes.length - 8) return false;
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const size = bytes.readUInt32LE(offset + 4);
      offset += 8 + size + (size % 2);
    }
    return offset === bytes.length;
  }
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const end = offset + 12 + size;
    if (end > bytes.length) return false;
    if (pngCrc(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) return false;
    offset = end;
    if (type === "IEND") return size === 0 && offset === bytes.length;
  }
  return false;
}

function pngCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ PNG_CRC_TABLE[(crc ^ byte) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}
