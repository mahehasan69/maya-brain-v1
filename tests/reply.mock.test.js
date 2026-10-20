
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";

import { generateReply } from "../src/reply.js";
import {
  initializeUser,
  startConversation
} from "../src/memory.js";
import {
  setRetentionConsent,
  setTrainingConsent
} from "../src/consent.js";

function makeTestEnv() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(readFileSync("database/schema.sql", "utf8"));

  const DB = {
    prepare(sql) {
      return {
        bind(...values) {
          const statement = sqlite.prepare(sql);

          return {
            async first() {
              return statement.get(...values) ?? null;
            },
            async all() {
              return { results: statement.all(...values) };
            },
            async run() {
              const result = statement.run(...values);
              return {
                meta: {
                  changes: result.changes,
                  last_row_id: Number(result.lastInsertRowid)
                }
              };
            }
          };
        }
      };
    }
  };

  return { env: { DB }, close: () => sqlite.close() };
}

async function createConversation(env) {
  await initializeUser(env, "user-a");
  await setRetentionConsent(env, "user-a", true);
  await setTrainingConsent(env, "user-a", false);
  return startConversation(env, "user-a");
}

test("returns mocked AI reply without calling Groq", async () => {
  const db = makeTestEnv();

  try {
    const conversation = await createConversation(db.env);
    let capturedRequest;

    const fetchImpl = async (url, init) => {
      capturedRequest = { url, init };

      return new Response(JSON.stringify({
        choices: [{
          message: { content: "Hey bro! I'm Maya." }
        }]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    };

    const reply = await generateReply(
      { ...db.env, GROQ_API_KEY: "test-key" },
      "user-a",
      conversation,
      "Hello Maya",
      { fetchImpl }
    );

    assert.equal(reply, "Hey bro! I'm Maya.");
    assert.equal(
      capturedRequest.url,
      "https://api.groq.com/openai/v1/chat/completions"
    );

    const requestBody = JSON.parse(capturedRequest.init.body);
    assert.equal(requestBody.model, "openai/gpt-oss-120b");
    assert.equal(requestBody.messages[1].role, "user");
    assert.match(requestBody.messages[1].content, /Hello Maya/);
    assert.equal(
      capturedRequest.init.headers.Authorization,
      "Bearer test-key"
    );
  } finally {
    db.close();
  }
});

test("handles provider HTTP errors safely", async () => {
  const db = makeTestEnv();

  try {
    const conversation = await createConversation(db.env);

    const fetchImpl = async () =>
      new Response("private provider diagnostic", { status: 503 });

    await assert.rejects(
      generateReply(
        { ...db.env, GROQ_API_KEY: "test-key" },
        "user-a",
        conversation,
        "Hello",
        { fetchImpl }
      ),
      /HTTP 503/
    );
  } finally {
    db.close();
  }
});

test("handles an empty AI response", async () => {
  const db = makeTestEnv();

  try {
    const conversation = await createConversation(db.env);

    const fetchImpl = async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: "  " } }]
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });

    await assert.rejects(
      generateReply(
        { ...db.env, GROQ_API_KEY: "test-key" },
        "user-a",
        conversation,
        "Hello",
        { fetchImpl }
      ),
      /empty reply/
    );
  } finally {
    db.close();
  }
});

test("diagnostic: injected fetch is actually called", async () => {
  const db = makeTestEnv();

  try {
    const conversation = await createConversation(db.env);
    let mockCalled = false;

    const fetchImpl = async () => {
      mockCalled = true;

      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: "Mock reply" } }
          ]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    };

    const reply = await generateReply(
      { ...db.env, GROQ_API_KEY: "test-key" },
      "user-a",
      conversation,
      "Hello Maya",
      { fetchImpl }
    );

    assert.equal(mockCalled, true);
    assert.equal(reply, "Mock reply");
  } finally {
    db.close();
  }
});
