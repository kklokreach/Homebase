const isProduction = process.env.NODE_ENV === "production";

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    return url.origin;
  } catch {
    return null;
  }
}

const configuredOrigins = parseCsv(process.env.CORS_ORIGINS)
  .map(normalizeOrigin)
  .filter((origin): origin is string => origin !== null);

const devOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
];

const allowedOrigins = new Set([
  ...configuredOrigins,
  ...(isProduction ? [] : devOrigins),
]);

const accessCode = process.env.HOMEBASE_ACCESS_CODE ?? "";
const sessionSecret = process.env.HOMEBASE_SESSION_SECRET ?? "";
const explicitAuthRequired = parseBoolean(process.env.HOMEBASE_REQUIRE_AUTH, false);
const authEnabled = Boolean(accessCode) || isProduction || explicitAuthRequired;

if (authEnabled && accessCode.length < 8) {
  throw new Error("HOMEBASE_ACCESS_CODE must be at least 8 characters when auth is enabled.");
}

if (authEnabled && sessionSecret.length < 32) {
  throw new Error("HOMEBASE_SESSION_SECRET must be at least 32 characters when auth is enabled.");
}

export const config = {
  isProduction,
  trustProxy: parseBoolean(process.env.TRUST_PROXY, isProduction),
  allowedOrigins,
  jsonBodyLimit: process.env.JSON_BODY_LIMIT ?? "64kb",
  auth: {
    enabled: authEnabled,
    accessCode,
    sessionSecret,
    cookieName: isProduction ? "__Host-homebase_session" : "homebase_session",
    sessionMaxAgeMs: parsePositiveInt(process.env.SESSION_MAX_AGE_MS, 1000 * 60 * 60 * 24 * 7),
  },
  rateLimits: {
    apiWindowMs: parsePositiveInt(process.env.API_RATE_LIMIT_WINDOW_MS, 1000 * 60),
    apiMax: parsePositiveInt(process.env.API_RATE_LIMIT_MAX, 300),
    loginWindowMs: parsePositiveInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS, 1000 * 60 * 15),
    loginMax: parsePositiveInt(process.env.LOGIN_RATE_LIMIT_MAX, 10),
  },
  calendar: {
    fetchTimeoutMs: parsePositiveInt(process.env.CALENDAR_FETCH_TIMEOUT_MS, 7000),
    maxFeedBytes: parsePositiveInt(process.env.CALENDAR_MAX_FEED_BYTES, 1024 * 1024 * 2),
  },
};

export function isAllowedOrigin(origin: string, hostOrigin?: string): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return normalized === hostOrigin || config.allowedOrigins.has(normalized);
}
