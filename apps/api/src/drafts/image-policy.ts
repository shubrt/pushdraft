import type { RasterImageMediaType } from "@pushdraft/contracts";

export type ImageValidation = { ok: true; bytes: Buffer } | { ok: false; errors: string[] };

export function validateImage(
  base64: string,
  mediaType: RasterImageMediaType,
  maxBytes: number,
): ImageValidation {
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

  return errors.length === 0 ? { ok: true, bytes } : { ok: false, errors };
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
