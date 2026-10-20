
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";

import {
  initializeUser,
  setMemoryEnabled,
  setHistoryEnabled,
  startConversation,
  saveMessage,
  proposeMemory,
  reviewMemory,
  retrieveMemories
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

async function answerBothChoices(env, userId, retention = true, training = false) {
  await setRetentionConsent(env, userId, retention);
  await setTrainingConsent(env, userId, training);
}

async function enableMemory(env, userId) {
  await answerBothChoices(env, userId, true, false);
  await setPersonalMemoryEnabled(env, userId, true);
}

test("new user has memory and history disabled", async () => {
  const db = makeTestEnv();
  try {
    const settings = await initializeUser(db.env, "user-a");
    assert.equal(settings.memory_enabled, 0);
    assert.equal(settings.history_enabled, 0);
    assert.equal(settings.training_consent, 0);
  } finally {
    db.close();
  }
});

test("messages are not stored when history is disabled", async () => {
  const db = makeTestEnv();
  try {
    await initializeUser(db.env, "user-a");
    await answerBothChoices(db.env, "user-a", true, false);

    const conversation = await startConversation(db.env, "user-a");
    assert.ok(conversation);

    const result = await saveMessage(
      db.env, "user-a", conversation, "user", "Hello Maya"
    );

    assert.deepEqual(result, {
      saved: false,
      reason: "history_disabled"
    });
  } finally {
    db.close();
  }
});

test("conversation is not started without retention consent", async () => {
  const db = makeTestEnv();
  try {
    await initializeUser(db.env, "user-a");

    const conversation = await startConversation(db.env, "user-a");
    assert.equal(conversation, null);
  } finally {
    db.close();
  }
});

test("memory is not stored when memory is disabled", async () => {
  const db = makeTestEnv();
  try {
    await initializeUser(db.env, "user-a");
    await answerBothChoices(db.env, "user-a", true, false);

    const result = await proposeMemory(
      db.env, "user-a", "preference", "Likes funny replies"
    );

    assert.deepEqual(result, {
      saved: false,
      reason: "memory_disabled"
    });
  } finally {
    db.close();
  }
});

test("only approved memories can be retrieved", async () => {
  const db = makeTestEnv();
  try {
    await initializeUser(db.env, "user-a");
    await enableMemory(db.env, "user-a");

    const pending = await proposeMemory(
      db.env, "user-a", "preference", "Likes gentle humour"
    );
    assert.equal(pending.saved, true);

    assert.equal(
      (await retrieveMemories(db.env, "user-a")).length,
      0
    );

    await reviewMemory(db.env, "user-a", pending.memoryId, true);

    const memories = await retrieveMemories(db.env, "user-a");
    assert.equal(memories.length, 1);
    assert.equal(memories[0].content, "Likes gentle humour");
  } finally {
    db.close();
  }
});

test("users cannot retrieve each other's memories", async () => {
  const db = makeTestEnv();
  try {
    await initializeUser(db.env, "user-a");
    await initializeUser(db.env, "user-b");

    await enableMemory(db.env, "user-a");
    await enableMemory(db.env, "user-b");

    const memory = await proposeMemory(
      db.env, "user-a", "milestone", "A fictional event"
    );
    assert.equal(memory.saved, true);

    await reviewMemory(db.env, "user-a", memory.memoryId, true);

    assert.equal(
      (await retrieveMemories(db.env, "user-b")).length,
      0
    );
  } finally {
    db.close();
  }
});

test("a user cannot write to another user's conversation", async () => {
  const db = makeTestEnv();
  try {
    await initializeUser(db.env, "user-a");
    await initializeUser(db.env, "user-b");

    await answerBothChoices(db.env, "user-a", true, false);
    await answerBothChoices(db.env, "user-b", true, false);

    await setHistoryEnabled(db.env, "user-a", true);
    await setHistoryEnabled(db.env, "user-b", true);

    const conversation = await startConversation(db.env, "user-a");
    assert.ok(conversation);

    await assert.rejects(
      saveMessage(
        db.env, "user-b", conversation, "user", "Private message"
      ),
      /Conversation not found/
    );
  } finally {
    db.close();
  }
});

test("revoking retention disables history and personal memory", async () => {
  const db = makeTestEnv();
  try {
    await initializeUser(db.env, "user-a");
    await enableMemory(db.env, "user-a");
    await setHistoryEnabled(db.env, "user-a", true);

    await setRetentionConsent(db.env, "user-a", false);

    const settings = await initializeUser(db.env, "user-a");
    assert.equal(settings.history_enabled, 0);
    assert.equal(settings.memory_enabled, 0);

    assert.equal(
      (await retrieveMemories(db.env, "user-a")).length,
      0
    );
  } finally {
    db.close();
  }
});
