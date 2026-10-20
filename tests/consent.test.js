
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

test("new user must answer both permission questions", async () => {
  const db = makeConsentEnv();
  try {
    const status = await initializeConsent(db.env, "user-a");
    assert.equal(status.onboardingRequired, true);
    assert.equal(status.retentionAnswered, false);
    assert.equal(status.trainingAnswered, false);
  } finally {
    db.close();
  }
});

test("answering only training does not complete onboarding", async () => {
  const db = makeConsentEnv();
  try {
    await initializeConsent(db.env, "user-a");
    const status = await setTrainingConsent(db.env, "user-a", false);

    assert.equal(status.trainingAnswered, true);
    assert.equal(status.retentionAnswered, false);
    assert.equal(status.onboardingRequired, true);
  } finally {
    db.close();
  }
});

test("answering both questions completes onboarding even when declined", async () => {
  const db = makeConsentEnv();
  try {
    await initializeConsent(db.env, "user-a");
    await setTrainingConsent(db.env, "user-a", false);
    const status = await setRetentionConsent(db.env, "user-a", false);

    assert.equal(status.onboardingRequired, false);
    assert.equal(status.retentionConsent, false);
    assert.equal(status.trainingConsent, false);
    assert.equal(status.historyEnabled, false);
  } finally {
    db.close();
  }
});

test("retention consent does not automatically grant training", async () => {
  const db = makeConsentEnv();
  try {
    await initializeConsent(db.env, "user-a");
    await setRetentionConsent(db.env, "user-a", true);
    const status = await setTrainingConsent(db.env, "user-a", false);

    assert.equal(status.retentionConsent, true);
    assert.equal(status.trainingConsent, false);
    assert.equal(status.onboardingRequired, false);
  } finally {
    db.close();
  }
});

test("personal memory cannot be enabled without retention consent", async () => {
  const db = makeConsentEnv();
  try {
    await initializeConsent(db.env, "user-a");
    await setTrainingConsent(db.env, "user-a", false);
    await setRetentionConsent(db.env, "user-a", false);

    await assert.rejects(
      setPersonalMemoryEnabled(db.env, "user-a", true),
      /retention consent/i
    );
  } finally {
    db.close();
  }
});

test("invalid consent values are rejected", async () => {
  const db = makeConsentEnv();
  try {
    await initializeConsent(db.env, "user-a");

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

test("consent choices are isolated between users", async () => {
  const db = makeConsentEnv();
  try {
    await initializeConsent(db.env, "user-a");
    await initializeConsent(db.env, "user-b");

    await setRetentionConsent(db.env, "user-a", true);
    await setTrainingConsent(db.env, "user-a", false);

    const a = await getConsentStatus(db.env, "user-a");
    const b = await getConsentStatus(db.env, "user-b");

    assert.equal(a.retentionConsent, true);
    assert.equal(a.trainingConsent, false);
    assert.equal(b.retentionConsent, false);
    assert.equal(b.trainingConsent, false);
    assert.equal(b.onboardingRequired, true);
  } finally {
    db.close();
  }
});
