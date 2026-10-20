
import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";

import {
  initializeConsent,
  getConsentStatus,
  setRetentionConsent,
  setTrainingConsent,
  setPersonalMemoryEnabled
} from "../src/consent.js";

function makeConsentEnv() {
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

test("new user has no consent and must complete onboarding", async () => {
  const db = makeConsentEnv();
  try {
    const status = await initializeConsent(db.env, "user-a");

    assert.equal(status.retentionConsent, false);
    assert.equal(status.trainingConsent, false);
    assert.equal(status.memoryEnabled, false);
    assert.equal(status.onboardingRequired, true);
  } finally {
    db.close();
  }
});

test("retention consent does not automatically grant training consent", async () => {
  const db = makeConsentEnv();
  try {
    await initializeConsent(db.env, "user-a");
    const status = await setRetentionConsent(
      db.env, "user-a", true
    );

    assert.equal(status.retentionConsent, true);
    assert.equal(status.trainingConsent, false);
  } finally {
    db.close();
  }
});

test("training consent can be declined independently", async () => {
  const db = makeConsentEnv();
  try {
    await initializeConsent(db.env, "user-a");
    const status = await setTrainingConsent(
      db.env, "user-a", false
    );

    assert.equal(status.trainingConsent, false);
  } finally {
    db.close();
  }
});

test("memory cannot be enabled without retention consent", async () => {
  const db = makeConsentEnv();
  try {
    await initializeConsent(db.env, "user-a");

    await assert.rejects(
      setPersonalMemoryEnabled(db.env, "user-a", true),
      /retention consent are required/
    );
  } finally {
    db.close();
  }
});

test("invalid consent values are rejected", async () => {
  const db = makeConsentEnv();
  try {
    await assert.rejects(
      setRetentionConsent(db.env, "user-a", "yes"),
      /true or false/
    );

    await assert.rejects(
      setTrainingConsent(db.env, "user-a", 1),
      /true or false/
    );
  } finally {
    db.close();
  }
});

test("consent status is isolated between users", async () => {
  const db = makeConsentEnv();
  try {
    await initializeConsent(db.env, "user-a");
    await initializeConsent(db.env, "user-b");
    await setRetentionConsent(db.env, "user-a", true);

    const userB = await getConsentStatus(db.env, "user-b");

    assert.equal(userB.retentionConsent, false);
    assert.equal(userB.trainingConsent, false);
  } finally {
    db.close();
  }
});
