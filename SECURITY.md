# Homebase Security Notes

## Required Production Settings

- Set `HOMEBASE_ACCESS_CODE` to a long private passcode.
- Set `HOMEBASE_SESSION_SECRET` to at least 32 random characters.
- Set `HOMEBASE_REQUIRE_AUTH=true`.
- Set `CORS_ORIGINS` to the exact frontend origin(s), comma-separated.
- Keep `HOMEBASE_COOKIE_SAME_SITE=none` when the frontend and API are served from different origins.
- Keep `DATABASE_URL` and calendar feed URLs out of git.
- Set `TRUST_PROXY=true` only when the app is behind a trusted proxy.
- Keep the `Security` GitHub Actions workflow required on pull requests.

## Current Protections

- HttpOnly, secure session cookie authentication. Production cookies default to `SameSite=None` so split frontend/API deployments can send them with credentialed requests.
- Production startup fails if auth secrets are missing or weak.
- Restricted CORS with credential support.
- Origin checks for state-changing requests.
- API security headers and no `X-Powered-By` header.
- JSON/form body size limits.
- In-memory rate limits for API traffic and login attempts.
- Sanitized error responses.
- Strict positive-integer route parameter parsing.
- Calendar feed URLs are restricted to HTTPS, checked against blocked private/reserved IP ranges, and read with a hard byte limit.
- CI runs production dependency auditing, typechecking, and a Windows build.

## Remaining Work

- Add a real user/household model before supporting multiple users.
- Put the app behind HTTPS in production.
- Use managed secret storage for production environment variables.
- Add database migrations for any future ownership/authorization columns.
