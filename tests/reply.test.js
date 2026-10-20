
import test from "node:test";
import assert from "node:assert/strict";
import { generateReply } from "../src/reply.js";

test("rejects a missing user ID", async () => {
  await assert.rejects(
    generateReply(
      { GROQ_API_KEY: "test-key" },
      "",
      "conversation-1",
      "Hello"
    ),
    /valid internal user ID/
  );
});

test("rejects a missing conversation ID", async () => {
  await assert.rejects(
    generateReply(
      { GROQ_API_KEY: "test-key" },
      "user-1",
      "",
      "Hello"
    ),
    /valid conversation ID/
  );
});

test("rejects an empty message", async () => {
  await assert.rejects(
    generateReply(
      { GROQ_API_KEY: "test-key" },
      "user-1",
      "conversation-1",
      "   "
    ),
    /non-empty string/
  );
});

test("rejects messages over the size limit", async () => {
  await assert.rejects(
    generateReply(
      { GROQ_API_KEY: "test-key" },
      "user-1",
      "conversation-1",
      "a".repeat(12001)
    ),
    /character limit/
  );
});

test("rejects a missing Groq API key", async () => {
  await assert.rejects(
    generateReply(
      {},
      "user-1",
      "conversation-1",
      "Hello"
    ),
    /GROQ_API_KEY is missing/
  );
});

test("exports generateReply as a function", () => {
  assert.equal(typeof generateReply, "function");
});
