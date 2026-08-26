const FUNCTION_PATHS = Object.freeze({
  list: "scripts:listByOwner",
  get: "scripts:getByOwner",
  create: "scripts:createForOwner",
  update: "scripts:updateForOwner",
  duplicate: "scripts:duplicateForOwner",
  delete: "scripts:deleteForOwner",
});

export class ScriptRepositoryError extends Error {}

/**
 * Calls the private Convex HTTP function endpoint with an admin credential.
 * The function protocol and `Convex` authorization header are grounded in the
 * installed ConvexHttpClient source. This module deliberately exposes only
 * the fixed script operations used by the public gateway.
 */
export function createConvexScriptRepository({ url, adminKey }) {
  let baseUrl;
  try {
    baseUrl = new URL(url);
  } catch {
    throw new Error("CONVEX_PRIVATE_URL must be a valid HTTP(S) URL");
  }
  if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
    throw new Error("CONVEX_PRIVATE_URL must be a valid HTTP(S) URL");
  }
  if (typeof adminKey !== "string" || adminKey.length === 0) {
    throw new Error("CONVEX_ADMIN_KEY must be set");
  }

  const endpoint = `${baseUrl.toString().replace(/\/$/, "")}/api/function`;

  async function call(path, args) {
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Convex ${adminKey}`,
        },
        body: JSON.stringify({
          path,
          format: "convex_encoded_json",
          args,
        }),
      });
    } catch {
      throw new ScriptRepositoryError("Private script storage is unavailable");
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new ScriptRepositoryError("Private script storage returned an invalid response");
    }
    if (!response.ok || payload?.status !== "success") {
      throw new ScriptRepositoryError("Private script storage request failed");
    }
    return payload.value;
  }

  return Object.freeze({
    list(ownerId) {
      return call(FUNCTION_PATHS.list, { ownerId });
    },
    get(ownerId, id) {
      return call(FUNCTION_PATHS.get, { ownerId, id });
    },
    create(ownerId, script) {
      return call(FUNCTION_PATHS.create, { ownerId, ...script });
    },
    update(ownerId, id, patch) {
      return call(FUNCTION_PATHS.update, { ownerId, id, ...patch });
    },
    duplicate(ownerId, id) {
      return call(FUNCTION_PATHS.duplicate, { ownerId, id });
    },
    delete(ownerId, id) {
      return call(FUNCTION_PATHS.delete, { ownerId, id });
    },
  });
}
