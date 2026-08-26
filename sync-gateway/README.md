# VoicePrompter sync gateway

A small public HTTPS API that establishes a VoicePrompter browser session after server-side username/password verification. Script data remains in private Convex storage; the gateway exposes only the fixed script operations used by the app.

## Local run

Requires Node.js 20 or newer.

```sh
cd sync-gateway
npm install
export AUTH_USERNAME='todd'
# Set AUTH_PASSWORD_SCRYPT from the server's secret store as base64url-salt:base64url-derived-key.
export AUTH_PASSWORD_SCRYPT='…'
export SESSION_SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')"
export CONVEX_PRIVATE_URL='http://private-convex.example'
export CONVEX_ADMIN_KEY='server-only-convex-admin-key'
export ALLOWED_ORIGINS='https://your-app.example'
npm start
```

`PORT` defaults to `8788`. Use `NODE_ENV=development` to additionally allow only the explicit development origins `http://localhost:5173` and `http://127.0.0.1:5173`; production callers must be listed exactly in `ALLOWED_ORIGINS` (a comma-separated list). `.env.example` documents every supported setting. Load real environment values through the hosting environment or an untracked local environment file.

The session cookie is always `Secure`, so a browser will retain it only when the gateway is served over HTTPS. For local development, place the service behind a local HTTPS reverse proxy if browser cookie testing is needed.

## Required environment

- `AUTH_USERNAME`: the private username accepted by password sign-in.
- `AUTH_PASSWORD_SCRYPT`: a server-only password verifier in `salt:derivedKey` format, where both values are base64url. It is created and stored outside the repository; plaintext passwords are never configured here.
- `SESSION_SECRET`: server-only random HMAC secret, at least 32 bytes.
- `CONVEX_PRIVATE_URL` and `CONVEX_ADMIN_KEY`: server-only private Convex connection values for the fixed script repository operations.
- `ALLOWED_ORIGINS`: comma-separated, exact allowed production browser origins. It may be empty only when running in explicit development mode.

Optional values are `PORT`, `SESSION_TTL_SECONDS` (60 seconds through 30 days; default eight hours), and `NODE_ENV=development`.

## Auth API

All responses with a body are JSON.

| Endpoint | Method | Behavior |
| --- | --- | --- |
| `/v1/auth/password` | `POST` | Requires `Origin` and `Content-Type: application/json`; accepts `{ "username": "…", "password": "…" }`. The supplied password is verified with Node's `crypto.scrypt` against `AUTH_PASSWORD_SCRYPT` and compared with `timingSafeEqual`. On success returns `200`, `{ "user": { "id": "…", "username": "…" } }`, and sets a session cookie. Invalid credentials return `401`; malformed input returns `400`, unsupported media type `415`, and oversized JSON `413`. Five failed attempts from the same gateway-observed IP within 15 minutes cause subsequent attempts to return `429` with `Retry-After` until the window expires. |
| `/v1/auth/logout` | `POST` | Requires `Origin`; returns `204` and expires the session cookie. |
| `/v1/auth/session` | `GET` | Returns `200` with either `{ "authenticated": true, "user": ... }` or `{ "authenticated": false }`. Invalid session cookies are expired. |

Known routes respond to preflight `OPTIONS`; unsupported methods return `405` with `Allow`. Unknown routes return `404`.

## Cookies and origins

A successful sign-in produces a stateless, HMAC-SHA-256 signed session containing only the authenticated username and issued/expiration timestamps. Sessions expire after the configured lifetime and cannot be accepted if modified. The cookie is named `__Host-voiceprompter_session` and is scoped to the gateway host with `Path=/`, `HttpOnly`, `Secure`, and `SameSite=Lax` attributes.

CORS never uses a wildcard. When an `Origin` header is present, it must exactly match a configured origin (or the two explicit localhost origins in `NODE_ENV=development`) before the gateway reflects it with credential support. Both mutating endpoints require an allowed `Origin` header, including non-browser requests, which prevents cookie-authenticated cross-origin writes.

## Private script storage

The gateway calls only fixed private Convex functions using server-only credentials and private network reachability. Do not put Convex credentials in the browser, expose Convex through this gateway as a generic proxy, or add public Convex routes.
