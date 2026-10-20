
import { generateReply } from "./reply.js";
import { setHistoryEnabled } from "./memory.js";

const ALLOWED_ORIGIN = "http://127.0.0.1:8000";

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Vary": "Origin"
  });

  if (origin === ALLOWED_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type"
    );
    headers.set("Access-Control-Max-Age", "600");
  }

  return headers;
}

function jsonResponse(data, status = 200, request) {
  const headers = corsHeaders(request);
  headers.set("Content-Type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(data), { status, headers });
}

function isAuthorized(request, env) {
  const secret = env.BRAIN_API_SECRET;
  const authorization = request.headers.get("Authorization");

  return (
    typeof secret === "string" &&
    secret.length >= 32 &&
    typeof authorization === "string" &&
    authorization === `Bearer ${secret}`
  );
}

async function readJson(request) {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const path = url.pathname;

    if (origin && origin !== ALLOWED_ORIGIN) {
      return jsonResponse({ error: "Origin not allowed" }, 403, request);
    }

    const allowedPaths = ["/reply", "/settings/history"];

    if (request.method === "OPTIONS" && allowedPaths.includes(path)) {
      if (origin !== ALLOWED_ORIGIN) {
        return jsonResponse({ error: "Origin not allowed" }, 403, request);
      }

      return new Response(null, {
        status: 204,
        headers: corsHeaders(request)
      });
    }

    if (request.method === "GET" && path === "/health") {
      return jsonResponse({
        ok: true,
        service: "maya-brain-v1",
        status: "online"
      }, 200, request);
    }

    if (!allowedPaths.includes(path)) {
      return jsonResponse({ error: "Not found" }, 404, request);
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, request);
    }

    if (!isAuthorized(request, env)) {
      return jsonResponse({ error: "Unauthorized" }, 401, request);
    }

    const parsed = await readJson(request);

    if (!parsed.ok) {
      return jsonResponse({ error: "Invalid JSON body" }, 400, request);
    }

    const body = parsed.body ?? {};

    // Consent-aware history settings endpoint.
    if (path === "/settings/history") {
      const { userId, enabled } = body;

      if (
        typeof userId !== "string" ||
        !userId.trim() ||
        userId.length > 200 ||
        typeof enabled !== "boolean"
      ) {
        return jsonResponse({
          error: "userId and boolean enabled are required"
        }, 400, request);
      }

      try {
        const settings = await setHistoryEnabled(
          env,
          userId,
          enabled
        );

        return jsonResponse({
          ok: true,
          userId,
          history_enabled: settings.history_enabled === 1
        }, 200, request);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";

        if (
          message === "User not initialized." ||
          message === "Current retention consent is required."
        ) {
          return jsonResponse({
            error: message
          }, 400, request);
        }

        return jsonResponse({
          error: "Unable to update history settings"
        }, 500, request);
      }
    }

    // Reply endpoint.
    if (!env.DB) {
      return jsonResponse(
        { error: "Service configuration error" },
        503,
        request
      );
    }

    if (!env.GROQ_API_KEY) {
      return jsonResponse(
        { error: "AI provider is not configured" },
        503,
        request
      );
    }

    const { userId, conversationId, message } = body;

    if (
      typeof userId !== "string" ||
      !userId.trim() ||
      typeof conversationId !== "string" ||
      !conversationId.trim() ||
      typeof message !== "string" ||
      !message.trim()
    ) {
      return jsonResponse({
        error: "userId, conversationId, and message are required"
      }, 400, request);
    }

    if (
      userId.length > 200 ||
      conversationId.length > 200 ||
      message.length > 12000
    ) {
      return jsonResponse(
        { error: "Request exceeds an allowed size" },
        413,
        request
      );
    }

    try {
      const reply = await generateReply(
        env,
        userId,
        conversationId,
        message
      );

      return jsonResponse({ ok: true, reply }, 200, request);
    } catch {
      return jsonResponse(
        { error: "Unable to generate a reply right now" },
        502,
        request
      );
    }
  }
};
