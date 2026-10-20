
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

function makeTestEnv() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(readFileSync("database/schema.sql", "utf8"));

  const DB = {
    prepare(sql) {
      let statement;
      return {
        bind(...values) {
          statement = sqlite.prepare(sql);
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
    const conversation = await startConversation(db.env, "user-a");
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

test("memory is not stored when memory is disabled", async () => {
  const db = makeTestEnv();
  try {
    await initializeUser(db.env, "user-a");
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
    await setMemoryEnabled(db.env, "user-a", true);

    const pending = await proposeMemory(
      db.env, "user-a", "preference", "Likes gentle humour"
    );

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
    await setMemoryEnabled(db.env, "user-a", true);
    await setMemoryEnabled(db.env, "user-b", true);

    const memory = await proposeMemory(
      db.env, "user-a", "milestone", "A fictional event"
    );
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
    await setHistoryEnabled(db.env, "user-a", true);
    await setHistoryEnabled(db.env, "user-b", true);

    const conversation = await startConversation(db.env, "user-a");

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
