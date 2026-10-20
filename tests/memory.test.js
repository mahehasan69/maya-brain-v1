
import test from "node:test";
import assert from "node:assert/strict";

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

test("memory engine exports its required functions", () => {
  assert.equal(typeof initializeUser, "function");
  assert.equal(typeof setMemoryEnabled, "function");
  assert.equal(typeof setHistoryEnabled, "function");
  assert.equal(typeof startConversation, "function");
  assert.equal(typeof saveMessage, "function");
  assert.equal(typeof proposeMemory, "function");
  assert.equal(typeof reviewMemory, "function");
  assert.equal(typeof retrieveMemories, "function");
});

test("database is required before memory operations", async () => {
  await assert.rejects(
    initializeUser({}, "test-user"),
    /DB binding is missing/
  );
});

test("invalid user IDs are rejected", async () => {
  await assert.rejects(
    initializeUser({ DB: {} }, ""),
    /valid internal user ID/
  );
});

test("invalid memory preferences are rejected", async () => {
  await assert.rejects(
    setMemoryEnabled({ DB: {} }, "test-user", "yes"),
    /true or false/
  );
});

test("invalid history preferences are rejected", async () => {
  await assert.rejects(
    setHistoryEnabled({ DB: {} }, "test-user", 1),
    /true or false/
  );
});

test("invalid message roles are rejected", async () => {
  await assert.rejects(
    saveMessage({}, "test-user", "conversation-1", "system", "test"),
    /Invalid message role/
  );
});

test("unsupported memory categories are rejected", async () => {
  await assert.rejects(
    proposeMemory(
      {},
      "test-user",
      "unsupported",
      "A fictional preference"
    ),
    /Unsupported memory category/
  );
});
