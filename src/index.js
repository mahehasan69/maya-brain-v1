
import { generateReply } from "./reply.js";
import {
  initializeUser,
  recordConsent,
  startConversation,
  setHistoryEnabled,
  setMemoryEnabled,
  proposeMemory,
  reviewMemory,
  retrieveMemories
} from "./memory.js";

const ALLOWED_ORIGIN = "http://127.0.0.1:8000";
const MAX_USER_ID_LENGTH = 200;
const MAX_CONVERSATION_ID_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 12000;
const MAX_MEMORY_CONTENT_LENGTH = 1000;

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
  const secret = env?.BRAIN_API_SECRET;
  const authorization = request.headers.get("Authorization");

  return (
    typeof secret === "string" &&
    secret.length >= 32 &&
    authorization === `Bearer ${secret}`
  );
}

async function readJson(request) {
  try {
    return {
      ok: true,
      body: await request.json()
    };
  } catch {
    return { ok: false };
  }
}

function validUserId(userId) {
  return (
    typeof userId === "string" &&
    userId.trim().length > 0 &&
    userId.length <= MAX_USER_ID_LENGTH
  );
}

function validConversationId(conversationId) {
  return (
    typeof conversationId === "string" &&
    conversationId.trim().length > 0 &&
    conversationId.length <= MAX_CONVERSATION_ID_LENGTH
  );
}

function databaseAvailable(env) {
  return Boolean(env?.DB);
}

function memoryErrorResponse(request) {
  return jsonResponse(
    { error: "Unable to complete the memory operation" },
    500,
    request
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const path = url.pathname;

    // Allow only the configured local browser tester.
    // Server-to-server calls without an Origin are supported.
    if (origin && origin !== ALLOWED_ORIGIN) {
      return jsonResponse({ error: "Origin not allowed" }, 403, request);
    }

    if (request.method === "GET" && path === "/health") {
      return jsonResponse({
        ok: true,
        service: "maya-brain-v1",
        status: "online"
      }, 200, request);
    }

    const allowedPaths = [
      "/onboarding",
      "/reply",
      "/settings/history",
      "/memory/test",
      "/memory/enable",
      "/memory/approve",
      "/memory/retrieve"
    ];

    if (!allowedPaths.includes(path)) {
      return jsonResponse({ error: "Not found" }, 404, request);
    }

    if (request.method === "OPTIONS") {
      if (origin !== ALLOWED_ORIGIN) {
        return jsonResponse({ error: "Origin not allowed" }, 403, request);
      }

      return new Response(null, {
        status: 204,
        headers: corsHeaders(request)
      });
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

    if (!databaseAvailable(env)) {
      return jsonResponse(
        { error: "Service configuration error" },
        503,
        request
      );
    }

    // Explicit onboarding choices and conversation initialization.
    if (path === "/onboarding") {
      const { userId, retentionConsent, trainingConsent } = body;

      if (
        !validUserId(userId) ||
        typeof retentionConsent !== "boolean" ||
        typeof trainingConsent !== "boolean"
      ) {
        return jsonResponse({
          error:
            "userId, boolean retentionConsent, and boolean trainingConsent are required"
        }, 400, request);
      }

      try {
        await initializeUser(env, userId);

        const settings = await recordConsent(
          env,
          userId,
          retentionConsent,
          trainingConsent
        );

        let conversationId = null;

        if (retentionConsent) {
          conversationId = await startConversation(env, userId);

          if (!conversationId) {
            return jsonResponse({
              error: "Consent saved, but conversation setup failed"
            }, 500, request);
          }
        }

        return jsonResponse({
          ok: true,
          userId,
          retentionConsent: settings.retention_consent === 1,
          trainingConsent: settings.training_consent === 1,
          conversationId
        }, 200, request);
      } catch {
        return jsonResponse(
          { error: "Unable to complete onboarding" },
          500,
          request
        );
      }
    }

    // Update conversation history setting.
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

        if (
          message === "User not initialized." ||
          message === "Current retention consent is required."
        ) {
          return jsonResponse({ error: message }, 400, request);
        }

        return jsonResponse(
          { error: "Unable to update history settings" },
          500,
          request
        );
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

        if (
          message === "User not initialized." ||
          message === "Current onboarding and retention consent are required."
        ) {
          return jsonResponse({ error: message }, 400, request);
        }

        return jsonResponse(
          { error: "Unable to update memory settings" },
          500,
          request
        );
      }
    }

    // Test the memory consent safeguards.
    if (path === "/memory/test") {
      const { userId, content } = body;

      if (
        !validUserId(userId) ||
        typeof content !== "string" ||
        !content.trim() ||
        content.length > MAX_MEMORY_CONTENT_LENGTH
      ) {
        return jsonResponse({
          error: "Valid userId and content (maximum 1000 characters) are required"
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
          test: "memory-consent-protection",
          result
        }, 200, request);
      } catch {
        return memoryErrorResponse(request);
      }
    }

    // Approve a pending memory for the specified user.
    if (path === "/memory/approve") {
      const { userId, memoryId } = body;

      if (
        !validUserId(userId) ||
        typeof memoryId !== "string" ||
        !memoryId.trim() ||
        memoryId.length > 200
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

        return jsonResponse({ ok: true, result }, 200, request);
      } catch {
        return memoryErrorResponse(request);
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
        return memoryErrorResponse(request);
      }
    }

    // Generate a reply.
    if (!env.GROQ_API_KEY) {
      return jsonResponse(
        { error: "AI provider is not configured" },
        503,
        request
      );
    }

    const { userId, conversationId, message } = body;

    if (
      !validUserId(userId) ||
      !validConversationId(conversationId) ||
      typeof message !== "string" ||
      !message.trim()
    ) {
      return jsonResponse({
        error: "Valid userId, conversationId, and message are required"
      }, 400, request);
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
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
      return jsonResponse(
        { error: "Unable to generate a reply right now" },
        502,
        request
      );
    }
  }
};
