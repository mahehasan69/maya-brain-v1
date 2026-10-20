
export const PRIVACY_NOTICE_VERSION = "1.0";

export const PRIVACY_NOTICE = `💜 Welcome to Maya!

I'm an AI companion. Before we start, please understand these choices.

1. CONVERSATION RETENTION
If you agree, Maya may store your conversations according to the published retention policy. Stored history can help provide continuity.

2. AI TRAINING
Separately, you can allow eligible conversations to be considered for improving Maya. Only approved examples may enter the training pipeline. Consent to retain conversations does not automatically authorize training.

3. PERSONAL MEMORY
Maya's saved personal memories are separate from archived conversations. Asking Maya to forget personal memories does not automatically delete archived conversations or information already incorporated into a trained model.

4. YOUR CHOICES
You can decline either permission and change your choices later. If you decline retention, Maya will not store conversation history. If you decline training, your conversations must not be used for future training.

Please avoid sharing passwords, payment credentials, government ID numbers, or other highly sensitive information.

Maya is an AI, not a human being, and may make mistakes.

Choose your permissions before continuing. Read the full Privacy Policy for retention periods, deletion procedures, and details about how data is protected.`;

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
           training_consent_at, consent_updated_at
    FROM user_settings
    WHERE user_id = ?
  `).bind(userId).first();

  if (!row) {
    return {
      initialized: false,
      onboardingRequired: true,
      retentionConsent: false,
      trainingConsent: false,
      memoryEnabled: false
    };
  }

  const noticeCurrent =
    row.privacy_notice_version === PRIVACY_NOTICE_VERSION;

  const retentionConsent = row.retention_consent === 1;
  const trainingConsent = row.training_consent === 1;

  return {
    initialized: true,
    onboardingRequired: !noticeCurrent,
    retentionConsent,
    trainingConsent,
    memoryEnabled: row.memory_enabled === 1,
    historyEnabled: row.history_enabled === 1,
    privacyNoticeVersion: row.privacy_notice_version
  };
}

/**
 * Record the user's explicit choice for conversation retention.
 * `accepted` must come from an actual user action in the interface.
 */
export async function setRetentionConsent(env, userId, accepted) {
  validateUserId(userId);

  if (typeof accepted !== "boolean") {
    throw new Error("Retention choice must be true or false.");
  }

  const db = requireDB(env);
  await initializeConsent(env, userId);

  await db.prepare(`
    UPDATE user_settings
    SET retention_consent = ?,
        history_enabled = ?,
        retention_consent_at = CASE
          WHEN ? = 1 THEN CURRENT_TIMESTAMP
          ELSE NULL
        END,
        privacy_notice_version = ?,
        consent_updated_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).bind(
    accepted ? 1 : 0,
    accepted ? 1 : 0,
    accepted ? 1 : 0,
    PRIVACY_NOTICE_VERSION,
    userId
  ).run();

  return getConsentStatus(env, userId);
}

/**
 * Training consent is separate from conversation retention.
 */
export async function setTrainingConsent(env, userId, accepted) {
  validateUserId(userId);

  if (typeof accepted !== "boolean") {
    throw new Error("Training choice must be true or false.");
  }

  const db = requireDB(env);
  await initializeConsent(env, userId);

  await db.prepare(`
    UPDATE user_settings
    SET training_consent = ?,
        training_consent_at = CASE
          WHEN ? = 1 THEN CURRENT_TIMESTAMP
          ELSE NULL
        END,
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

/**
 * Enable personal memory only when the user has explicitly
 * agreed to the current notice and conversation retention.
 */
export async function setPersonalMemoryEnabled(env, userId, enabled) {
  validateUserId(userId);

  if (typeof enabled !== "boolean") {
    throw new Error("Memory preference must be true or false.");
  }

  const db = requireDB(env);
  const status = await getConsentStatus(env, userId);

  if (
    enabled &&
    (!status.initialized ||
      status.onboardingRequired ||
      !status.retentionConsent)
  ) {
    throw new Error("Current notice and retention consent are required.");
  }

  await db.prepare(`
    UPDATE user_settings
    SET memory_enabled = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).bind(enabled ? 1 : 0, userId).run();

  return getConsentStatus(env, userId);
}
