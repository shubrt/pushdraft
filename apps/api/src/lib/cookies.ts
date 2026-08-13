export type CookieOptions = {
  maxAge: number;
  secure: boolean;
  sameSite?: "Lax" | "Strict";
  httpOnly?: boolean;
};

export function serializeHostCookie(name: string, value: string, options: CookieOptions): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `SameSite=${options.sameSite ?? "Lax"}`,
    `Max-Age=${options.maxAge}`,
  ];
  if (options.httpOnly !== false) attributes.push("HttpOnly");
  if (options.secure) attributes.push("Secure");
  return attributes.join("; ");
}

export function readCookie(headers: Headers, name: string): string | null {
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}
