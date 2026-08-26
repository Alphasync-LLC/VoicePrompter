import { createHmac, scrypt, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { createConvexScriptRepository, ScriptRepositoryError } from "./convex-script-repository.js";

const SESSION_COOKIE = "__Host-voiceprompter_session";
const JSON_BODY_LIMIT = 16 * 1024;
const DEFAULT_SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const DEVELOPMENT_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
const MAX_FAILED_PASSWORD_ATTEMPTS = 5;
const PASSWORD_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const scryptAsync = promisify(scrypt);

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

function parseTtl(value) {
  if (value === undefined || value === "") {
    return DEFAULT_SESSION_TTL_SECONDS;
  }

  const ttl = Number(value);
  if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > MAX_SESSION_TTL_SECONDS) {
    throw new Error(`SESSION_TTL_SECONDS must be an integer from 60 to ${MAX_SESSION_TTL_SECONDS}`);
  }
  return ttl;
}

function parsePasswordScrypt(value) {
  const [salt, derivedKey, ...rest] = value.split(":");
  if (!salt || !derivedKey || rest.length > 0) {
    throw new Error("AUTH_PASSWORD_SCRYPT must be formatted as salt:derivedKey");
  }

  const saltBuffer = Buffer.from(salt, "base64url");
  const derivedKeyBuffer = Buffer.from(derivedKey, "base64url");
  if (
    saltBuffer.length === 0 ||
    derivedKeyBuffer.length === 0 ||
    saltBuffer.toString("base64url") !== salt ||
    derivedKeyBuffer.toString("base64url") !== derivedKey
  ) {
    throw new Error("AUTH_PASSWORD_SCRYPT must contain base64url salt and derivedKey values");
  }
  return { salt: saltBuffer, derivedKey: derivedKeyBuffer };
}

function configuredOrigins() {
  const origins = new Set(
    (process.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  for (const origin of origins) {
    const url = new URL(origin);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== origin) {
      throw new Error("ALLOWED_ORIGINS entries must be exact HTTP(S) origins");
    }
  }

  if (process.env.NODE_ENV === "development") {
    for (const origin of DEVELOPMENT_ORIGINS) {
      origins.add(origin);
    }
  }

  return origins;
}

const config = {
  authUsername: requiredEnv("AUTH_USERNAME"),
  passwordScrypt: parsePasswordScrypt(requiredEnv("AUTH_PASSWORD_SCRYPT")),
  sessionSecret: requiredEnv("SESSION_SECRET"),
  convexPrivateUrl: requiredEnv("CONVEX_PRIVATE_URL"),
  convexAdminKey: requiredEnv("CONVEX_ADMIN_KEY"),
  sessionTtlSeconds: parseTtl(process.env.SESSION_TTL_SECONDS),
  allowedOrigins: configuredOrigins(),
  port: Number(process.env.PORT ?? 8788),
};

if (Buffer.byteLength(config.sessionSecret) < 32) {
  throw new Error("SESSION_SECRET must be at least 32 bytes");
}
if (!Number.isSafeInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error("PORT must be a valid TCP port");
}

const failedPasswordAttempts = new Map();
const scripts = createConvexScriptRepository({
  url: config.convexPrivateUrl,
  adminKey: config.convexAdminKey,
});

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signature(payload) {
  return createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
}

function signSession(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = encode({
    sub: user.username,
    username: user.username,
    iat: now,
    exp: now + config.sessionTtlSeconds,
  });
  return `${payload}.${signature(payload)}`;
}

function verifySession(token) {
  if (typeof token !== "string") return null;
  const [payload, receivedSignature, ...rest] = token.split(".");
  if (!payload || !receivedSignature || rest.length > 0) return null;

  const expectedSignature = signature(payload);
  const received = Buffer.from(receivedSignature);
  const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (
      !session ||
      typeof session.sub !== "string" ||
      typeof session.username !== "string" ||
      session.sub !== session.username ||
      !Number.isSafeInteger(session.iat) ||
      !Number.isSafeInteger(session.exp) ||
      session.iat > now ||
      session.exp <= now ||
      session.exp - session.iat > config.sessionTtlSeconds
    ) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const cookies = new Map();
  if (!header) return cookies;

  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (separator === -1) continue;
    cookies.set(entry.slice(0, separator).trim(), entry.slice(separator + 1).trim());
  }
  return cookies;
}

function serializeSessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${config.sessionTtlSeconds}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function appendVary(response, value) {
  const existing = response.getHeader("Vary");
  response.setHeader("Vary", existing ? `${existing}, ${value}` : value);
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (!config.allowedOrigins.has(origin)) return false;

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Credentials", "true");
  appendVary(response, "Origin");
  return true;
}

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...extraHeaders });
  response.end(JSON.stringify(body));
}

function sendNoContent(response, status, extraHeaders = {}) {
  response.writeHead(status, extraHeaders);
  response.end();
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_BODY_LIMIT) {
      const error = new Error("Request body is too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON");
    error.status = 400;
    throw error;
  }
}

function publicUser(session) {
  return {
    id: session.sub,
    username: session.username,
  };
}

function clientIp(request) {
  return request.socket.remoteAddress ?? "unknown";
}

function passwordRetryAfter(ip, now) {
  const attempt = failedPasswordAttempts.get(ip);
  if (!attempt) return 0;
  if (attempt.expiresAt <= now) {
    failedPasswordAttempts.delete(ip);
    return 0;
  }
  return attempt.count >= MAX_FAILED_PASSWORD_ATTEMPTS
    ? Math.max(1, Math.ceil((attempt.expiresAt - now) / 1000))
    : 0;
}

function recordFailedPasswordAttempt(ip, now) {
  const existing = failedPasswordAttempts.get(ip);
  if (existing && existing.expiresAt > now) {
    existing.count += 1;
    return;
  }
  failedPasswordAttempts.set(ip, { count: 1, expiresAt: now + PASSWORD_ATTEMPT_WINDOW_MS });
}

function equalBuffers(left, right) {
  return left.length === right.length && timingSafeEqual(left, right);
}

async function authenticatePassword(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const error = new Error("Request body must be an object");
    error.status = 400;
    throw error;
  }
  if (
    typeof body.username !== "string" ||
    body.username.length === 0 ||
    body.username.length > 128 ||
    typeof body.password !== "string" ||
    body.password.length > 1024
  ) {
    const error = new Error("username and password must be valid strings");
    error.status = 400;
    throw error;
  }

  const derivedKey = await scryptAsync(body.password, config.passwordScrypt.salt, config.passwordScrypt.derivedKey.length);
  const passwordMatches = equalBuffers(derivedKey, config.passwordScrypt.derivedKey);
  const usernameMatches = equalBuffers(Buffer.from(body.username), Buffer.from(config.authUsername));
  return passwordMatches && usernameMatches ? { username: config.authUsername } : null;
}
function scriptRoute(pathname) {
  if (pathname === "/v1/scripts") {
    return { kind: "collection", methods: ["GET", "POST", "OPTIONS"] };
  }

  const match = /^\/v1\/scripts\/([^/]+)(?:\/(duplicate))?$/.exec(pathname);
  if (!match) return null;
  try {
    return {
      kind: match[2] === "duplicate" ? "duplicate" : "item",
      id: decodeURIComponent(match[1]),
      methods: match[2] === "duplicate" ? ["POST", "OPTIONS"] : ["GET", "PATCH", "DELETE", "OPTIONS"],
    };
  } catch {
    return null;
  }
}

function allowedMethods(pathname) {
  if (pathname === "/v1/auth/session") return ["GET", "OPTIONS"];
  if (pathname === "/v1/auth/password" || pathname === "/v1/auth/logout") return ["POST", "OPTIONS"];
  return scriptRoute(pathname)?.methods ?? null;
}

function publicScript(script) {
  return {
    id: script._id,
    title: script.title,
    content: script.content,
    preview: script.preview,
    createdAt: script.createdAt,
    updatedAt: script.updatedAt,
    googleDocUrl: script.googleDocUrl,
    wordCount: script.wordCount,
    isFavorite: script.isFavorite,
    tag: script.tag,
  };
}

function requireScriptBody(body, requiredFields = []) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const error = new Error("Request body must be an object");
    error.status = 400;
    throw error;
  }
  for (const field of requiredFields) {
    if (typeof body[field] !== "string") {
      const error = new Error(`${field} must be a string`);
      error.status = 400;
      throw error;
    }
  }
  return body;
}

function scriptPatch(body) {
  const patch = {};
  for (const field of ["title", "content", "googleDocUrl", "tag"]) {
    if (Object.hasOwn(body, field)) {
      if (typeof body[field] !== "string") {
        const error = new Error(`${field} must be a string`);
        error.status = 400;
        throw error;
      }
      patch[field] = body[field];
    }
  }
  if (Object.hasOwn(body, "isFavorite")) {
    if (typeof body.isFavorite !== "boolean") {
      const error = new Error("isFavorite must be a boolean");
      error.status = 400;
      throw error;
    }
    patch.isFavorite = body.isFavorite;
  }
  if (Object.keys(patch).length === 0) {
    const error = new Error("At least one script field is required");
    error.status = 400;
    throw error;
  }
  return patch;
}

function requiresJson(method) {
  return method === "POST" || method === "PATCH";
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const { pathname } = url;
  const method = request.method ?? "GET";
  const route = scriptRoute(pathname);
  const methods = allowedMethods(pathname);
  if (!methods) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (!applyCors(request, response)) {
    sendJson(response, 403, { error: "Origin is not allowed" });
    return;
  }

  if (method === "OPTIONS") {
    const requestedMethod = request.headers["access-control-request-method"];
    if (!requestedMethod || !methods.filter((item) => item !== "OPTIONS").includes(requestedMethod)) {
      sendJson(response, 405, { error: "Method not allowed" }, { Allow: methods.join(", ") });
      return;
    }
    response.setHeader("Access-Control-Allow-Methods", methods.filter((item) => item !== "OPTIONS").join(", "));
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Max-Age", "600");
    sendNoContent(response, 204);
    return;
  }

  try {
    if (route) {
      if (!route.methods.includes(method)) {
        sendJson(response, 405, { error: "Method not allowed" }, { Allow: route.methods.join(", ") });
        return;
      }

      const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
      const session = verifySession(token);
      if (!session) {
        sendJson(response, 401, { error: "Authentication required" }, token ? { "Set-Cookie": clearSessionCookie() } : undefined);
        return;
      }
      if (requiresJson(method)) {
        if (!request.headers.origin) {
          sendJson(response, 403, { error: "Origin is required" });
          return;
        }
        if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
          sendJson(response, 415, { error: "Content-Type must be application/json" });
          return;
        }
      }

      if (route.kind === "collection" && method === "GET") {
        sendJson(response, 200, { scripts: (await scripts.list(session.sub)).map(publicScript) });
        return;
      }
      if (route.kind === "collection") {
        const body = requireScriptBody(await readJson(request), ["title", "content"]);
        for (const field of ["googleDocUrl", "tag"]) {
          if (Object.hasOwn(body, field) && typeof body[field] !== "string") {
            const error = new Error(`${field} must be a string`);
            error.status = 400;
            throw error;
          }
        }
        const script = await scripts.create(session.sub, {
          title: body.title,
          content: body.content,
          ...(typeof body.googleDocUrl === "string" ? { googleDocUrl: body.googleDocUrl } : {}),
          ...(typeof body.tag === "string" ? { tag: body.tag } : {}),
        });
        sendJson(response, 201, { script: publicScript(script) });
        return;
      }
      if (route.kind === "duplicate") {
        const script = await scripts.duplicate(session.sub, route.id);
        if (!script) {
          sendJson(response, 404, { error: "Script not found" });
          return;
        }
        sendJson(response, 201, { script: publicScript(script) });
        return;
      }
      if (method === "GET") {
        const script = await scripts.get(session.sub, route.id);
        if (!script) {
          sendJson(response, 404, { error: "Script not found" });
          return;
        }
        sendJson(response, 200, { script: publicScript(script) });
        return;
      }
      if (method === "PATCH") {
        const script = await scripts.update(session.sub, route.id, scriptPatch(requireScriptBody(await readJson(request))));
        if (!script) {
          sendJson(response, 404, { error: "Script not found" });
          return;
        }
        sendJson(response, 200, { script: publicScript(script) });
        return;
      }
      if (!(await scripts.delete(session.sub, route.id))) {
        sendJson(response, 404, { error: "Script not found" });
        return;
      }
      sendNoContent(response, 204);
      return;
    }

    if (pathname === "/v1/auth/password") {
      if (method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" }, { Allow: "POST, OPTIONS" });
        return;
      }
      if (!request.headers.origin) {
        sendJson(response, 403, { error: "Origin is required" });
        return;
      }
      if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
        sendJson(response, 415, { error: "Content-Type must be application/json" });
        return;
      }

      const ip = clientIp(request);
      const now = Date.now();
      const retryAfter = passwordRetryAfter(ip, now);
      if (retryAfter) {
        sendJson(response, 429, { error: "Too many failed sign-in attempts" }, { "Retry-After": String(retryAfter) });
        return;
      }

      const user = await authenticatePassword(await readJson(request));
      if (!user) {
        recordFailedPasswordAttempt(ip, now);
        sendJson(response, 401, { error: "Invalid username or password" });
        return;
      }
      failedPasswordAttempts.delete(ip);
      const session = { sub: user.username, username: user.username };
      sendJson(response, 200, { user: publicUser(session) }, { "Set-Cookie": serializeSessionCookie(signSession(user)) });
      return;
    }

    if (pathname === "/v1/auth/logout") {
      if (method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" }, { Allow: "POST, OPTIONS" });
        return;
      }
      if (!request.headers.origin) {
        sendJson(response, 403, { error: "Origin is required" });
        return;
      }
      sendNoContent(response, 204, { "Set-Cookie": clearSessionCookie() });
      return;
    }

    if (method !== "GET") {
      sendJson(response, 405, { error: "Method not allowed" }, { Allow: "GET, OPTIONS" });
      return;
    }
    const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
    const session = verifySession(token);
    if (!session) {
      sendJson(response, 200, { authenticated: false }, token ? { "Set-Cookie": clearSessionCookie() } : undefined);
      return;
    }
    sendJson(response, 200, { authenticated: true, user: publicUser(session) });
  } catch (error) {
    if (error instanceof ScriptRepositoryError) {
      console.error(`Script storage request failed: ${error.message}`);
      sendJson(response, 503, { error: "Script storage is unavailable" });
      return;
    }
    console.error(`Gateway request failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    const status = Number.isInteger(error.status) ? error.status : 401;
    if (status === 401) {
      sendJson(response, 401, { error: "Authentication failed" });
      return;
    }
    sendJson(response, status, { error: error.message });
  }
});

server.listen(config.port, () => {
  console.log(`VoicePrompter sync gateway listening on port ${config.port}`);
});

