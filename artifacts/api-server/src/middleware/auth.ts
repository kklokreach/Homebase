import { createHmac, timingSafeEqual } from "node:crypto";
import type { CookieOptions, Request, RequestHandler, Response } from "express";
import { config } from "../lib/config";

type SessionPayload = {
  exp: number;
  v: 1;
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string): string {
  return createHmac("sha256", config.auth.sessionSecret).update(value).digest("base64url");
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const left = createHmac("sha256", config.auth.sessionSecret).update(a).digest();
  const right = createHmac("sha256", config.auth.sessionSecret).update(b).digest();
  return timingSafeEqual(left, right);
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProduction || config.auth.cookieSameSite === "none",
    sameSite: config.auth.cookieSameSite,
    partitioned: config.auth.cookiePartitioned,
    priority: "high",
    path: "/",
    maxAge: config.auth.sessionMaxAgeMs,
  };
}

export function isAuthEnabled(): boolean {
  return config.auth.enabled;
}

export function verifyAccessCode(accessCode: string): boolean {
  if (!config.auth.enabled) return true;
  return timingSafeStringEqual(accessCode, config.auth.accessCode);
}

export function createSessionCookieValue(now = Date.now()): string {
  const payload: SessionPayload = {
    exp: now + config.auth.sessionMaxAgeMs,
    v: 1,
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function verifySessionCookieValue(value: unknown, now = Date.now()): boolean {
  if (!config.auth.enabled) return true;
  if (typeof value !== "string") return false;

  const [body, signature, ...extra] = value.split(".");
  if (!body || !signature || extra.length > 0) return false;
  if (!timingSafeStringEqual(signature, sign(body))) return false;

  try {
    const payload = JSON.parse(base64UrlDecode(body)) as Partial<SessionPayload>;
    return payload.v === 1 && typeof payload.exp === "number" && payload.exp > now;
  } catch {
    return false;
  }
}

export function setSessionCookie(res: Response): void {
  res.cookie(config.auth.cookieName, createSessionCookieValue(), cookieOptions());
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.auth.cookieName, {
    ...cookieOptions(),
    maxAge: undefined,
  });
}

export function isAuthenticated(req: Request): boolean {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  return verifySessionCookieValue(cookies?.[config.auth.cookieName]);
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!config.auth.enabled || isAuthenticated(req)) {
    next();
    return;
  }

  res.status(401).json({ error: "Authentication required" });
};
