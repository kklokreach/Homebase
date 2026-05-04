import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";
import { config, isAllowedOrigin } from "./lib/config";
import { rateLimit } from "./middleware/rate-limit";
import {
  errorHandler,
  notFoundHandler,
  originGuard,
  securityHeaders,
} from "./middleware/security";

const app: Express = express();
const frontendDistDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../homebase/dist/public",
);

app.disable("x-powered-by");
if (config.trustProxy) app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(securityHeaders);
app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
  }),
);
app.use(originGuard);
app.use(cookieParser());
app.use(express.json({ limit: config.jsonBodyLimit }));
app.use(express.urlencoded({ extended: false, limit: config.jsonBodyLimit }));
app.use(
  rateLimit({
    keyPrefix: "api",
    windowMs: config.rateLimits.apiWindowMs,
    max: config.rateLimits.apiMax,
  }),
);

app.use("/api", router);

if (existsSync(path.join(frontendDistDir, "index.html"))) {
  app.use(express.static(frontendDistDir, { index: false }));
  app.get(/^(?!\/api(?:\/|$)).*/, (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }

    res.sendFile(path.join(frontendDistDir, "index.html"));
  });
}

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
