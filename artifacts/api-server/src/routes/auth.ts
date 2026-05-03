import { Router, type IRouter } from "express";
import { config } from "../lib/config";
import { isPlainObject } from "../lib/http";
import { rateLimit } from "../middleware/rate-limit";
import {
  clearSessionCookie,
  isAuthEnabled,
  isAuthenticated,
  setSessionCookie,
  verifyAccessCode,
} from "../middleware/auth";

const router: IRouter = Router();

const loginLimiter = rateLimit({
  keyPrefix: "auth-login",
  windowMs: config.rateLimits.loginWindowMs,
  max: config.rateLimits.loginMax,
});

router.get("/auth/session", (req, res) => {
  res.json({
    authRequired: isAuthEnabled(),
    authenticated: isAuthenticated(req),
  });
});

router.post("/auth/login", loginLimiter, (req, res): void => {
  if (!isAuthEnabled()) {
    res.json({ authenticated: true });
    return;
  }

  if (!isPlainObject(req.body) || typeof req.body["accessCode"] !== "string") {
    res.status(400).json({ error: "accessCode is required" });
    return;
  }

  const accessCode = req.body["accessCode"];
  if (accessCode.length > 256 || !verifyAccessCode(accessCode)) {
    res.status(401).json({ error: "Invalid access code" });
    return;
  }

  setSessionCookie(res);
  res.json({ authenticated: true });
});

router.post("/auth/logout", (_req, res): void => {
  clearSessionCookie(res);
  res.sendStatus(204);
});

export default router;
