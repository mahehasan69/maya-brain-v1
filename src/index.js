
import { generateReply } from "./reply.js";

const ALLOWED_ORIGIN = "null";

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

  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

function isAuthorized(request, env) {
  const secret = env.BRAIN_API_SECRET;
  const authorization = request.headers.get("Authorization");

  if (
    typeof secret !== "string" ||
    secret.length < 32 ||
    typeof authorization !== "string"
  ) {
    return false;
  }

  return authorization === `Bearer ${secret}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    // Only allow browser requests from a local HTML file.
    // Server-to-server requests without an Origin header remain supported.
    if (origin && origin !== ALLOWED_ORIGIN) {
      return jsonResponse(
        { error: "Origin not allowed" },
        403,
        request
      );
    }

    // Handle browser preflight before authentication.
    if (request.method === "OPTIONS" && url.pathname === "/reply") {
      if (origin !== ALLOWED_ORIGIN) {
        return jsonResponse({ error: "Origin not allowed" }, 403, request);
      }

      return new Response(null, {
        status: 204,
        headers: corsHeaders(request)
      });
    }

    // Public health check.
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        service: "maya-brain-v1",
        status: "online"
      }, 200, request);
    }

    if (url.pathname !== "/reply") {
      return jsonResponse({ error: "Not found" }, 404, request);
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, request);
    }

    if (!isAuthorized(request, env)) {
      return jsonResponse({ error: "Unauthorized" }, 401, request);
    }

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

    let body;

    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400, request);
    }

    const { userId, conversationId, message } = body ?? {};

    if (
      typeof userId !== "string" ||
      !userId.trim() ||
      typeof conversationId !== "string" ||
      !conversationId.trim() ||
      typeof message !== "string" ||
      !message.trim()
    ) {
      return jsonResponse(
        { error: "userId, conversationId, and message are required" },
        400,
        request
      );
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
