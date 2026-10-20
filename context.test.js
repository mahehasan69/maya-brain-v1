
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";

import { buildContext } from "../src/context.js";
import {
  initializeUser,
  startConversation,
  setMemoryEnabled,
  setHistoryEnabled,
  proposeMemory,
  reviewMemory,
  saveMessage
} from "../src/memory.js";

import {
  setRetentionConsent,
  setTrainingConsent,
  setPersonalMemoryEnabled
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

async function prepareUser(env, userId) {
  await initializeUser(env, userId);
  await setRetentionConsent(env, userId, true);
  await setTrainingConsent(env, userId, false);
}

test("context is empty when consent has not been given", async () => {
  const db = makeTestEnv();

  try {
    await initializeUser(db.env, "user-a");

    const context = await buildContext(
      db.env, "user-a", "missing-conversation"
    );

    assert.deepEqual(context, {
      memories: [],
      recentMessages: [],
      contextText: ""
    });
  } finally {
    db.close();
  }
});

test("context includes approved memories when memory is enabled", async () => {
  const db = makeTestEnv();

  try {
    await prepareUser(db.env, "user-a");
    await setPersonalMemoryEnabled(db.env, "user-a", true);

    const conversation = await startConversation(db.env, "user-a");
    assert.ok(conversation);

    const proposed = await proposeMemory(
      db.env,
      "user-a",
      "preference",
      "Likes short replies"
    );

    assert.equal(proposed.saved, true);
    await reviewMemory(db.env, "user-a", proposed.memoryId, true);

    const context = await buildContext(
      db.env, "user-a", conversation
    );

    assert.equal(context.memories.length, 1);
    assert.equal(context.memories[0].content, "Likes short replies");
    assert.match(context.contextText, /Likes short replies/);
  } finally {
    db.close();
  }
});

test("context excludes memories when personal memory is disabled", async () => {
  const db = makeTestEnv();

  try {
    await prepareUser(db.env, "user-a");

    const conversation = await startConversation(db.env, "user-a");
    assert.ok(conversation);

    const context = await buildContext(
      db.env, "user-a", conversation
    );

    assert.deepEqual(context.memories, []);
  } finally {
    db.close();
  }
});

test("context excludes history when history is disabled", async () => {
  const db = makeTestEnv();

  try {
    await prepareUser(db.env, "user-a");

    const conversation = await startConversation(db.env, "user-a");
    assert.ok(conversation);

    // History is disabled by default.
    const context = await buildContext(
      db.env, "user-a", conversation
    );

    assert.deepEqual(context.recentMessages, []);
  } finally {
    db.close();
  }
});

test("context includes recent messages when history is enabled", async () => {
  const db = makeTestEnv();

  try {
    await prepareUser(db.env, "user-a");
    await setHistoryEnabled(db.env, "user-a", true);

    const conversation = await startConversation(db.env, "user-a");
    assert.ok(conversation);

    await saveMessage(
      db.env, "user-a", conversation, "user", "Hello Maya"
    );
    await saveMessage(
      db.env, "user-a", conversation, "assistant", "Hey there!"
    );

    const context = await buildContext(
      db.env, "user-a", conversation
    );

    assert.equal(context.recentMessages.length, 2);
    assert.equal(context.recentMessages[0].content, "Hello Maya");
    assert.equal(context.recentMessages[1].content, "Hey there!");
  } finally {
    db.close();
  }
});

test("a user cannot load another user's conversation context", async () => {
  const db = makeTestEnv();

  try {
    await prepareUser(db.env, "user-a");
    await prepareUser(db.env, "user-b");

    const conversation = await startConversation(db.env, "user-a");
    assert.ok(conversation);

    await assert.rejects(
      buildContext(db.env, "user-b", conversation),
      /Conversation not found/
    );
  } finally {
    db.close();
  }
});

test("invalid context limits are rejected", async () => {
  const db = makeTestEnv();

  try {
    await prepareUser(db.env, "user-a");

    const conversation = await startConversation(db.env, "user-a");
    assert.ok(conversation);

    await assert.rejects(
      buildContext(db.env, "user-a", conversation, {
        messageLimit: 0
      }),
      /Message limit/
    );

    await assert.rejects(
      buildContext(db.env, "user-a", conversation, {
        memoryLimit: 101
      }),
      /Memory limit/
    );
  } finally {
    db.close();
  }
});
