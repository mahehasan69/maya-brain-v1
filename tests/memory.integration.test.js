
export const PRIVACY_NOTICE_VERSION = "1.0";

export const PRIVACY_NOTICE =
  "Maya can store conversation history and personal memories only according to your choices. " +
  "Training data use requires separate consent. You can change your choices later.";

function requireDB(env) {
  if (!env?.DB) {
    throw new Error("Consent module: DB binding is missing.");
  }
  return env.DB;
}

function validateUserId(userId) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new Error("A valid internal user ID is required.");
  }
}

function validateChoice(value, name) {
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be true or false.`);
  }
}

export async function initializeConsent(env, userId) {
  validateUserId(userId);

  const db = requireDB(env);

  await db.prepare(`
    INSERT OR IGNORE INTO user_settings (user_id)
    VALUES (?)
  `).bind(userId).run();

  return getConsentStatus(env, userId);
}

export async function getConsentStatus(env, userId) {
  validateUserId(userId);

  const db = requireDB(env);

  const row = await db.prepare(`
    SELECT user_id,
           memory_enabled,
           history_enabled,
           retention_consent,
           training_consent,
           privacy_notice_version,
           retention_choice_at,
           training_choice_at
    FROM user_settings
    WHERE user_id = ?
  `).bind(userId).first();

  if (!row) {
    return {
      initialized: false,
      onboardingRequired: true,
      retentionAnswered: false,
      trainingAnswered: false,
      retentionConsent: false,
      trainingConsent: false,
      memoryEnabled: false,
      historyEnabled: false
    };
  }

  const retentionAnswered = row.retention_choice_at != null;
  const trainingAnswered = row.training_choice_at != null;

  const onboardingRequired = !(
    row.privacy_notice_version === PRIVACY_NOTICE_VERSION &&
    retentionAnswered &&
    trainingAnswered
  );

  return {
    initialized: true,
    onboardingRequired,
    retentionAnswered,
    trainingAnswered,
    retentionConsent: row.retention_consent === 1,
    trainingConsent: row.training_consent === 1,
    memoryEnabled: row.memory_enabled === 1,
    historyEnabled: row.history_enabled === 1
  };
}

export async function setRetentionConsent(env, userId, accepted) {
  validateUserId(userId);
  validateChoice(accepted, "Retention consent");

  const db = requireDB(env);

  await db.prepare(`
    INSERT OR IGNORE INTO user_settings (user_id)
    VALUES (?)
  `).bind(userId).run();

  await db.prepare(`
    UPDATE user_settings
    SET retention_consent = ?,
        history_enabled = CASE
          WHEN ? = 0 THEN 0
          ELSE history_enabled
        END,
        memory_enabled = CASE
          WHEN ? = 0 THEN 0
          ELSE memory_enabled
        END,
        retention_consent_at = CASE
          WHEN ? = 1 THEN CURRENT_TIMESTAMP
          ELSE NULL
        END,
        retention_choice_at = CURRENT_TIMESTAMP,
        privacy_notice_version = ?,
        consent_updated_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).bind(
    accepted ? 1 : 0,
    accepted ? 1 : 0,
    accepted ? 1 : 0,
    accepted ? 1 : 0,
    PRIVACY_NOTICE_VERSION,
    userId
  ).run();

  return getConsentStatus(env, userId);
}

export async function setTrainingConsent(env, userId, accepted) {
  validateUserId(userId);
  validateChoice(accepted, "Training consent");

  const db = requireDB(env);

  await db.prepare(`
    INSERT OR IGNORE INTO user_settings (user_id)
    VALUES (?)
  `).bind(userId).run();

  await db.prepare(`
    UPDATE user_settings
    SET training_consent = ?,
        training_consent_at = CASE
          WHEN ? = 1 THEN CURRENT_TIMESTAMP
          ELSE NULL
        END,
        training_choice_at = CURRENT_TIMESTAMP,
        privacy_notice_version = ?,
        consent_updated_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).bind(
    accepted ? 1 : 0,
    accepted ? 1 : 0,
    PRIVACY_NOTICE_VERSION,
    userId
  ).run();

  return getConsentStatus(env, userId);
}

export async function setPersonalMemoryEnabled(env, userId, enabled) {
  validateUserId(userId);
  validateChoice(enabled, "Memory preference");

  const db = requireDB(env);
  const status = await getConsentStatus(env, userId);

  if (!status.initialized) {
    throw new Error("User not initialized.");
  }

  if (enabled) {
    if (status.onboardingRequired || !status.retentionConsent) {
      throw new Error(
        "Completed onboarding and retention consent are required."
      );
    }
  }

  await db.prepare(`
    UPDATE user_settings
    SET memory_enabled = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).bind(enabled ? 1 : 0, userId).run();

  return getConsentStatus(env, userId);
}
