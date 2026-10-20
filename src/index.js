
import { generateReply } from "./reply.js";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
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

    // Public health check: never expose secrets or database details.
    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        service: "maya-brain-v1",
        status: "online"
      });
    }

    if (url.pathname !== "/reply") {
      return jsonResponse({ error: "Not found" }, 404);
    }

    if (request.method !== "POST") {
      return jsonResponse(
        { error: "Method not allowed" },
        405
      );
    }

    if (!isAuthorized(request, env)) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    if (!env.DB) {
      return jsonResponse(
        { error: "Service configuration error" },
        503
      );
    }

    if (!env.GROQ_API_KEY) {
      return jsonResponse(
        { error: "AI provider is not configured" },
        503
      );
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
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
        {
          error:
            "userId, conversationId, and message are required"
        },
        400
      );
    }

    if (
      userId.length > 200 ||
      conversationId.length > 200 ||
      message.length > 12000
    ) {
      return jsonResponse(
        { error: "Request exceeds an allowed size" },
        413
      );
    }

    try {
      const reply = await generateReply(
        env,
        userId,
        conversationId,
        message
      );

      return jsonResponse({ ok: true, reply });
    } catch {
      // Keep internal errors, SQL details, and provider diagnostics private.
      return jsonResponse(
        { error: "Unable to generate a reply right now" },
        502
      );
    }
  }
};
