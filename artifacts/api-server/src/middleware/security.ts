import type { ErrorRequestHandler, RequestHandler } from "express";
import { config, isAllowedOrigin } from "../lib/config";
import { logger } from "../lib/logger";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function contentSecurityPolicy(req: Parameters<RequestHandler>[0]): string {
  if (req.path.startsWith("/api")) {
    return "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
  }

  const allowedConnectOrigins = Array.from(config.allowedOrigins);

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src 'self' ${allowedConnectOrigins.join(" ")}`.trim(),
  ].join("; ");
}

function getHostOrigin(req: Parameters<RequestHandler>[0]): string | undefined {
  const host = req.get("host");
  if (!host) return undefined;
  return `${req.protocol}://${host}`;
}

function getRequestOrigin(req: Parameters<RequestHandler>[0]): string | undefined {
  const origin = req.get("origin");
  if (origin) return origin;

  const referer = req.get("referer");
  if (!referer) return undefined;

  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}

export const securityHeaders: RequestHandler = (req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Content-Security-Policy", contentSecurityPolicy(req));

  if (config.isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }

  next();
};

export const originGuard: RequestHandler = (req, res, next) => {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const origin = getRequestOrigin(req);
  if (origin && isAllowedOrigin(origin, getHostOrigin(req))) {
    next();
    return;
  }

  if (!origin && !config.isProduction) {
    next();
    return;
  }

  res.status(403).json({ error: "Origin not allowed" });
};

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Not found" });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status =
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof err.status === "number"
      ? err.status
      : 500;

  const type =
    typeof err === "object" &&
    err !== null &&
    "type" in err &&
    typeof err.type === "string"
      ? err.type
      : "";

  const safeStatus =
    type === "entity.too.large"
      ? 413
      : type === "entity.parse.failed"
        ? 400
        : status >= 400 && status < 600
          ? status
          : 500;

  logger.error(
    {
      err,
      method: req.method,
      path: req.path,
      statusCode: safeStatus,
    },
    "Request failed",
  );

  if (res.headersSent) return;

  const message =
    safeStatus === 400
      ? "Invalid request body"
      : safeStatus === 413
        ? "Request body too large"
        : "Internal server error";

  res.status(safeStatus).json({ error: message });
};
