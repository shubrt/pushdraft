const DEFAULT_LOCAL_URL = "http://localhost:3003";

export type AppConfig = {
  port: number;
  databaseUrl: string;
  publicUrl: URL;
  sessionSecret: string;
  shooBaseUrl: URL;
  maxHtmlBytes: number;
  isProduction: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProduction = env.NODE_ENV === "production";
  const publicUrl = parsePublicUrl(resolvePublicUrl(env), isProduction);

  return {
    port: readPositiveInteger(env.PORT, 3003),
    databaseUrl: requireValue("DATABASE_URL", env.DATABASE_URL),
    publicUrl,
    sessionSecret: requireSecret(env.SESSION_SECRET),
    shooBaseUrl: parseHttpsUrl(env.SHOO_BASE_URL ?? "https://shoo.dev", "SHOO_BASE_URL"),
    maxHtmlBytes: readPositiveInteger(env.MAX_HTML_BYTES, 512 * 1024),
    isProduction,
  };
}

// Railway PR environments copy production variables verbatim, so PUBLIC_URL
// would point at production there. Outside the production environment the
// Railway-generated service domain is the canonical origin instead.
function resolvePublicUrl(env: NodeJS.ProcessEnv): string {
  const railwayEnvironment = env.RAILWAY_ENVIRONMENT_NAME?.trim();
  const railwayDomain = env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railwayEnvironment && railwayEnvironment !== "production" && railwayDomain) {
    return `https://${railwayDomain}`;
  }
  return env.PUBLIC_URL ?? DEFAULT_LOCAL_URL;
}

function parsePublicUrl(value: string, isProduction: boolean): URL {
  const url = new URL(value);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PUBLIC_URL must be an origin without a path, query, or fragment.");
  }
  if (isProduction && url.protocol !== "https:") {
    throw new Error("PUBLIC_URL must use HTTPS in production.");
  }
  if (!isProduction && url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("PUBLIC_URL must use HTTP or HTTPS.");
  }
  return url;
}

function parseHttpsUrl(value: string, name: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && !isLoopback(url.hostname)) {
    throw new Error(`${name} must use HTTPS.`);
  }
  return url;
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function requireValue(name: string, value: string | undefined): string {
  if (!value?.trim()) throw new Error(`Missing required environment variable: ${name}`);
  return value.trim();
}

function requireSecret(value: string | undefined): string {
  const secret = requireValue("SESSION_SECRET", value);
  if (Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 bytes.");
  }
  return secret;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${JSON.stringify(value)}.`);
  }
  return parsed;
}
