
import { generateReply } from "./reply.js";
import {
  setHistoryEnabled,
  setMemoryEnabled,
  proposeMemory,
  reviewMemory,
  retrieveMemories
} from "./memory.js";

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

function validUserId(userId) {
  return (
    typeof userId === "string" &&
    userId.trim().length > 0 &&
    userId.length <= 200
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const path = url.pathname;

    if (origin && origin !== ALLOWED_ORIGIN) {
      return jsonResponse(
        { error: "Origin not allowed" },
        403,
        request
      );
    }

    const allowedPaths = [
      "/reply",
      "/settings/history",
      "/memory/test",
      "/memory/enable",
      "/memory/approve",
      "/memory/retrieve"
    ];

    if (request.method === "OPTIONS" && allowedPaths.includes(path)) {
      if (origin !== ALLOWED_ORIGIN) {
        return jsonResponse(
          { error: "Origin not allowed" },
          403,
          request
        );
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
      return jsonResponse(
        { error: "Method not allowed" },
        405,
        request
      );
    }

    if (!isAuthorized(request, env)) {
      return jsonResponse({ error: "Unauthorized" }, 401, request);
    }

    const parsed = await readJson(request);

    if (!parsed.ok) {
      return jsonResponse({ error: "Invalid JSON body" }, 400, request);
    }

    const body = parsed.body ?? {};

    // Conversation-history preference.
    if (path === "/settings/history") {
      const { userId, enabled } = body;

      if (!validUserId(userId) || typeof enabled !== "boolean") {
        return jsonResponse({
          error: "userId and boolean enabled are required"
        }, 400, request);
      }

      try {
        const settings = await setHistoryEnabled(env, userId, enabled);

        return jsonResponse({
          ok: true,
          userId,
          history_enabled: settings.history_enabled === 1
        }, 200, request);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";

        const status = [
          "User not initialized.",
          "Current retention consent is required."
        ].includes(message) ? 400 : 500;

        return jsonResponse({
          error: status === 400
            ? message
            : "Unable to update history settings"
        }, status, request);
      }
    }

    // Enable or disable long-term memory.
    if (path === "/memory/enable") {
      const { userId, enabled } = body;

      if (!validUserId(userId) || typeof enabled !== "boolean") {
        return jsonResponse({
          error: "userId and boolean enabled are required"
        }, 400, request);
      }

      try {
        const settings = await setMemoryEnabled(env, userId, enabled);

        return jsonResponse({
          ok: true,
          userId,
          memory_enabled: settings.memory_enabled === 1
        }, 200, request);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const status = message === "User not initialized." ? 400 : 400;

        return jsonResponse({
          error: message || "Unable to update memory settings"
        }, status, request);
      }
    }

    // Protected test: propose a memory.
    if (path === "/memory/test") {
      const { userId, content } = body;

      if (
        !validUserId(userId) ||
        typeof content !== "string" ||
        !content.trim() ||
        content.length > 1000
      ) {
        return jsonResponse({
          error: "Valid userId and content are required"
        }, 400, request);
      }

      try {
        const result = await proposeMemory(
          env,
          userId,
          "preference",
          content
        );

        return jsonResponse({
          ok: true,
          test: "memory-disabled-protection",
          result
        }, 200, request);
      } catch {
        return jsonResponse({
          error: "Memory test failed"
        }, 500, request);
      }
    }

    // Approve a pending memory for this user.
    if (path === "/memory/approve") {
      const { userId, memoryId } = body;

      if (
        !validUserId(userId) ||
        typeof memoryId !== "string" ||
        !memoryId.trim()
      ) {
        return jsonResponse({
          error: "Valid userId and memoryId are required"
        }, 400, request);
      }

      try {
        const result = await reviewMemory(
          env,
          userId,
          memoryId,
          true
        );

        return jsonResponse({
          ok: true,
          result
        }, 200, request);
      } catch {
        return jsonResponse({
          error: "Unable to review memory"
        }, 500, request);
      }
    }

    // Retrieve approved, unexpired memories.
    if (path === "/memory/retrieve") {
      const { userId } = body;

      if (!validUserId(userId)) {
        return jsonResponse({
          error: "A valid userId is required"
        }, 400, request);
      }

      try {
        const memories = await retrieveMemories(
          env,
          userId,
          null,
          10
        );

        return jsonResponse({
          ok: true,
          count: memories.length,
          memories
        }, 200, request);
      } catch {
        return jsonResponse({
          error: "Unable to retrieve memories"
        }, 500, request);
      }
    }

    // Generate an AI reply.
    if (!env.DB || !env.GROQ_API_KEY) {
      return jsonResponse({
        error: "Service configuration error"
      }, 503, request);
    }

    const { userId, conversationId, message } = body;

    if (
      !validUserId(userId) ||
      typeof conversationId !== "string" ||
      !conversationId.trim() ||
      conversationId.length > 200 ||
      typeof message !== "string" ||
      !message.trim()
    ) {
      return jsonResponse({
        error: "Valid userId, conversationId, and message are required"
      }, 400, request);
    }

    if (message.length > 12000) {
      return jsonResponse({
        error: "Message exceeds the 12000-character limit"
      }, 413, request);
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
      return jsonResponse({
        error: "Unable to generate a reply right now"
      }, 502, request);
    }
  }
};
