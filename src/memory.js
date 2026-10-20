
const PRIVACY_NOTICE_VERSION = "1.0";

const ALLOWED_MEMORY_CATEGORIES = [
  "preference",
  "milestone",
  "goal",
  "interest",
  "important_event"
];

function requireDB(env) {
  if (!env?.DB) {
    throw new Error("DB binding is missing");
  }
  return env.DB;
}

function validateUserId(userId) {
  if (
    typeof userId !== "string" ||
    !userId.trim() ||
    userId.length > 200
  ) {
    throw new Error("A valid internal user ID is required");
  }
}

function validateBoolean(value, name) {
  if (typeof value !== "boolean") {
    throw new Error(`${name} must be true or false.`);
  }
}

async function getSettingsRow(db, userId) {
  return db.prepare(`
    SELECT user_id, memory_enabled, history_enabled,
           retention_consent, training_consent,
           privacy_notice_version, retention_choice_at,
           training_choice_at
    FROM user_settings
    WHERE user_id = ?
  `).bind(userId).first();
}

function onboardingComplete(row) {
  return Boolean(
    row &&
    row.privacy_notice_version === PRIVACY_NOTICE_VERSION &&
    row.retention_choice_at != null &&
    row.training_choice_at != null
  );
}

async function ensureUser(db, userId) {
  await db.prepare(`
    INSERT OR IGNORE INTO user_settings (user_id)
    VALUES (?)
  `).bind(userId).run();

  return getSettingsRow(db, userId);
}

async function requireRetentionConsent(db, userId) {
  const row = await getSettingsRow(db, userId);

  if (
    !row ||
    !onboardingComplete(row) ||
    row.retention_consent !== 1
  ) {
    return { allowed: false, row };
  }

  return { allowed: true, row };
}

export async function initializeUser(env, userId) {
  validateUserId(userId);
  return ensureUser(requireDB(env), userId);
}

export async function recordConsent(
  env,
  userId,
  retentionConsent,
  trainingConsent
) {
  validateUserId(userId);
  validateBoolean(retentionConsent, "Retention consent");
  validateBoolean(trainingConsent, "Training consent");

  const db = requireDB(env);
  await ensureUser(db, userId);

  const now = new Date().toISOString();

  await db.prepare(`
    UPDATE user_settings
    SET retention_consent = ?,
        training_consent = ?,
        privacy_notice_version = ?,
        retention_choice_at = ?,
        training_choice_at = ?,
        retention_consent_at = ?,
        training_consent_at = ?,
        consent_updated_at = ?,
        memory_enabled = 0,
        history_enabled = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).bind(
    retentionConsent ? 1 : 0,
    trainingConsent ? 1 : 0,
    PRIVACY_NOTICE_VERSION,
    now,
    now,
    retentionConsent ? now : null,
    trainingConsent ? now : null,
    now,
    userId
  ).run();

  return getSettingsRow(db, userId);
}

export async function startConversation(env, userId) {
  validateUserId(userId);

  const db = requireDB(env);
  await ensureUser(db, userId);

  const permission = await requireRetentionConsent(db, userId);

  if (!permission.allowed) {
    return null;
  }

  const conversationId = crypto.randomUUID();

  await db.prepare(`
    INSERT INTO conversations (conversation_id, user_id)
    VALUES (?, ?)
  `).bind(conversationId, userId).run();

  return conversationId;
}

export async function setHistoryEnabled(env, userId, enabled) {
  validateUserId(userId);
  validateBoolean(enabled, "History setting");

  const db = requireDB(env);
  const row = await getSettingsRow(db, userId);

  if (!row) {
    throw new Error("User not initialized.");
  }

  if (enabled) {
    const permission = await requireRetentionConsent(db, userId);

    if (!permission.allowed) {
      throw new Error("Current retention consent is required.");
    }
  }

  await db.prepare(`
    UPDATE user_settings
    SET history_enabled = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).bind(enabled ? 1 : 0, userId).run();

  return getSettingsRow(db, userId);
}

export async function setMemoryEnabled(env, userId, enabled) {
  validateUserId(userId);
  validateBoolean(enabled, "Memory setting");

  const db = requireDB(env);
  const row = await getSettingsRow(db, userId);

  if (!row) {
    throw new Error("User not initialized.");
  }

  if (enabled) {
    const permission = await requireRetentionConsent(db, userId);

    if (!permission.allowed) {
      throw new Error(
        "Current onboarding and retention consent are required."
      );
    }
  }

  await db.prepare(`
    UPDATE user_settings
    SET memory_enabled = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).bind(enabled ? 1 : 0, userId).run();

  return getSettingsRow(db, userId);
}

export async function saveMessage(
  env,
  userId,
  conversationId,
  role,
  content
) {
  validateUserId(userId);

  if (
    typeof conversationId !== "string" ||
    !conversationId.trim() ||
    conversationId.length > 200
  ) {
    throw new Error("A valid conversation ID is required.");
  }

  if (!["user", "assistant"].includes(role)) {
    throw new Error("Invalid message role.");
  }

  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Message content is required.");
  }

  const db = requireDB(env);
  const permission = await requireRetentionConsent(db, userId);

  if (!permission.allowed) {
    return { saved: false, reason: "consent_required" };
  }

  if (permission.row.history_enabled !== 1) {
    return { saved: false, reason: "history_disabled" };
  }

  const conversation = await db.prepare(`
    SELECT conversation_id
    FROM conversations
    WHERE conversation_id = ? AND user_id = ?
  `).bind(conversationId, userId).first();

  if (!conversation) {
    throw new Error("Conversation not found.");
  }

  await db.prepare(`
    INSERT INTO messages (conversation_id, role, content)
    VALUES (?, ?, ?)
  `).bind(conversationId, role, content).run();

  return { saved: true };
}

export async function proposeMemory(
  env,
  userId,
  category,
  content,
  sourceMessageId = null
) {
  validateUserId(userId);

  if (!ALLOWED_MEMORY_CATEGORIES.includes(category)) {
    throw new Error("Unsupported memory category.");
  }

  if (
    typeof content !== "string" ||
    !content.trim() ||
    content.length > 1000
  ) {
    throw new Error("Memory content must be 1–1000 characters.");
  }

  if (
    sourceMessageId !== null &&
    (!Number.isInteger(sourceMessageId) || sourceMessageId < 1)
  ) {
    throw new Error("Invalid source message ID.");
  }

  const db = requireDB(env);
  const permission = await requireRetentionConsent(db, userId);

  if (!permission.allowed) {
    return { saved: false, reason: "consent_required" };
  }

  if (permission.row.memory_enabled !== 1) {
    return { saved: false, reason: "memory_disabled" };
  }

  if (sourceMessageId !== null) {
    const source = await db.prepare(`
      SELECT m.message_id
      FROM messages m
      JOIN conversations c
        ON c.conversation_id = m.conversation_id
      WHERE m.message_id = ? AND c.user_id = ?
    `).bind(sourceMessageId, userId).first();

    if (!source) {
      throw new Error("Source message not found.");
    }
  }

  const memoryId = crypto.randomUUID();

  await db.prepare(`
    INSERT INTO memories (
      memory_id, user_id, category, content,
      source_message_id, review_status
    )
    VALUES (?, ?, ?, ?, ?, 'pending')
  `).bind(
    memoryId,
    userId,
    category,
    content.trim(),
    sourceMessageId
  ).run();

  return { saved: true, memoryId };
}

export async function reviewMemory(
  env,
  userId,
  memoryId,
  approved
) {
  validateUserId(userId);
  validateBoolean(approved, "Approval");

  if (typeof memoryId !== "string" || !memoryId.trim()) {
    throw new Error("A valid memory ID is required.");
  }

  const db = requireDB(env);

  const result = await db.prepare(`
    UPDATE memories
    SET review_status = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE memory_id = ?
      AND user_id = ?
      AND review_status = 'pending'
  `).bind(
    approved ? "approved" : "rejected",
    memoryId,
    userId
  ).run();

  return {
    updated: (result.meta?.changes ?? 0) > 0
  };
}

export async function retrieveMemories(
  env,
  userId,
  category = null,
  limit = 10
) {
  validateUserId(userId);

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Limit must be between 1 and 100.");
  }

  if (
    category !== null &&
    !ALLOWED_MEMORY_CATEGORIES.includes(category)
  ) {
    throw new Error("Unsupported memory category.");
  }

  const db = requireDB(env);
  const permission = await requireRetentionConsent(db, userId);

  if (!permission.allowed || permission.row.memory_enabled !== 1) {
    return [];
  }

  const statement = category === null
    ? db.prepare(`
        SELECT memory_id, category, content, confidence, created_at
        FROM memories
        WHERE user_id = ?
          AND review_status = 'approved'
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        ORDER BY created_at DESC
        LIMIT ?
      `).bind(userId, limit)
    : db.prepare(`
        SELECT memory_id, category, content, confidence, created_at
        FROM memories
        WHERE user_id = ?
          AND category = ?
          AND review_status = 'approved'
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        ORDER BY created_at DESC
        LIMIT ?
      `).bind(userId, category, limit);

  const result = await statement.all();
  return result.results ?? [];
}
