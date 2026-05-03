import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
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
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
