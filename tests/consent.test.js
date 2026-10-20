

export const PRIVACY_NOTICE_VERSION = "1.0";

export const PRIVACY_NOTICE = `💜 Welcome to Maya!

I'm an AI companion. Please review these choices before continuing.

1. CONVERSATION RETENTION
If you agree, Maya may store conversations according to the published retention policy.

2. AI TRAINING
Separately, you may allow eligible, approved examples to be considered for improving Maya. Retention consent does not authorize training.

3. PERSONAL MEMORY
Personal memories are separate from archived conversations. Deleting memories does not automatically delete archived conversations or information already incorporated into a trained model.

4. YOUR CHOICES
You may decline either permission and change your choices later. Declining retention means Maya must not store conversation history. Declining training means your conversations must not be used for future training.

Avoid sharing passwords, payment credentials, government ID numbers, or other highly sensitive information.

Maya is an AI, not a human, and may make mistakes.

Please answer both permission questions before continuing. Read the full Privacy Policy for retention periods, deletion procedures, and data protection details.`;

function requireDB(env) {
  if (!env?.DB) throw new Error("Consent module: DB binding is missing.");
  return env.DB;
}

function validateUserId(userId) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new Error("A valid internal user ID is required.");
  }
}

function validateChoice(accepted, label) {
  if (typeof accepted !== "boolean") {
    throw new Error(`${label} choice must be true or false.`);
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
    SELECT user_id, retention_consent, training_consent,
           memory_enabled, history_enabled,
           privacy_notice_version, retention_consent_at,
           training_consent_at, retention_choice_at,
           training_choice_at, consent_updated_at
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
  const noticeCurrent =
    row.privacy_notice_version === PRIVACY_NOTICE_VERSION;

  return {
    initialized: true,
    onboardingRequired:
      !noticeCurrent || !retentionAnswered || !trainingAnswered,
    retentionAnswered,
    trainingAnswered,
    retentionConsent: row.retention_consent === 1,
    trainingConsent: row.training_consent === 1,
    memoryEnabled: row.memory_enabled === 1,
    historyEnabled: row.history_enabled === 1,
    privacyNoticeVersion: row.privacy_notice_version
  };
}

export async function setRetentionConsent(env, userId, accepted) {
  validateUserId(userId);
  validateChoice(accepted, "Retention");

  const db = requireDB(env);
  await initializeConsent(env, userId);

  await db.prepare(`
    UPDATE user_settings
    SET retention_consent = ?,
        history_enabled = ?,
        memory_enabled = CASE WHEN ? = 1 THEN memory_enabled ELSE 0 END,
        retention_consent_at = CASE
          WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL
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
  validateChoice(accepted, "Training");

  const db = requireDB(env);
  await initializeConsent(env, userId);

  await db.prepare(`
    UPDATE user_settings
    SET training_consent = ?,
        training_consent_at = CASE
          WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL
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
  validateChoice(enabled, "Memory");

  const db = requireDB(env);
  const status = await getConsentStatus(env, userId);

  if (enabled && (
    !status.initialized ||
    status.onboardingRequired ||
    !status.retentionConsent
  )) {
    throw new Error(
      "Both permission choices and current retention consent are required."
    );
  }

  await db.prepare(`
    UPDATE user_settings
    SET memory_enabled = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).bind(enabled ? 1 : 0, userId).run();

  return getConsentStatus(env, userId);
}
