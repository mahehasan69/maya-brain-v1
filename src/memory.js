
/**
 * Maya Memory Engine v1
 * Cloudflare D1 compatible.
 *
 * This module is not connected to a live database yet.
 * The caller must provide env.DB, a configured D1 binding.
 */

function requireDB(env) {
  if (!env?.DB) {
    throw new Error("Maya Memory Engine: DB binding is missing.");
  }
  return env.DB;
}

function validateUserId(userId) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw new Error("A valid internal user ID is required.");
  }
}

async function getSettings(env, userId) {
  validateUserId(userId);
  const db = requireDB(env);

  return db.prepare(`
    SELECT user_id, memory_enabled, history_enabled,
           training_consent, retention_days
    FROM user_settings
    WHERE user_id = ?
  `).bind(userId).first();
}

/**
 * Create settings with privacy protections enabled by default.
 * Existing preferences are preserved.
 */
export async function initializeUser(env, userId) {
  validateUserId(userId);
  const db = requireDB(env);

  await db.prepare(`
    INSERT OR IGNORE INTO user_settings (user_id)
    VALUES (?)
  `).bind(userId).run();

  return getSettings(env, userId);
}

/**
 * Explicitly update a user's memory preference.
 */
export async function setMemoryEnabled(env, userId, enabled) {
  validateUserId(userId);

  if (typeof enabled !== "boolean") {
    throw new Error("Memory preference must be true or false.");
  }

  const db = requireDB(env);

  await initializeUser(env, userId);

  await db.prepare(`
    UPDATE user_settings
    SET memory_enabled = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).bind(enabled ? 1 : 0, userId).run();

  return getSettings(env, userId);
}

/**
 * Explicitly update conversation-history preference.
 */
export async function setHistoryEnabled(env, userId, enabled) {
  validateUserId(userId);

  if (typeof enabled !== "boolean") {
    throw new Error("History preference must be true or false.");
  }

  const db = requireDB(env);

  await initializeUser(env, userId);

  await db.prepare(`
    UPDATE user_settings
    SET history_enabled = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).bind(enabled ? 1 : 0, userId).run();

  return getSettings(env, userId);
}

/**
 * Start a conversation for an initialized user.
 */
export async function startConversation(env, userId) {
  validateUserId(userId);
  const db = requireDB(env);

  await initializeUser(env, userId);

  const conversationId = crypto.randomUUID();

  await db.prepare(`
    INSERT INTO conversations (conversation_id, user_id)
    VALUES (?, ?)
  `).bind(conversationId, userId).run();

  return conversationId;
}

/**
 * Save a message only when conversation history is enabled.
 * Never call this with API keys, passwords, or authentication tokens.
 */
export async function saveMessage(
  env,
  userId,
  conversationId,
  role,
  content
) {
  validateUserId(userId);

  if (!["user", "assistant"].includes(role)) {
    throw new Error("Invalid message role.");
  }

  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Message content must not be empty.");
  }

  const db = requireDB(env);
  const settings = await getSettings(env, userId);

  if (!settings || settings.history_enabled !== 1) {
    return { saved: false, reason: "history_disabled" };
  }

  // Verify conversation ownership before writing.
  const conversation = await db.prepare(`
    SELECT conversation_id
    FROM conversations
    WHERE conversation_id = ? AND user_id = ?
  `).bind(conversationId, userId).first();

  if (!conversation) {
    throw new Error("Conversation not found for this user.");
  }

  const result = await db.prepare(`
    INSERT INTO messages (conversation_id, role, content)
    VALUES (?, ?, ?)
  `).bind(conversationId, role, content).run();

  return {
    saved: true,
    messageId: result.meta?.last_row_id ?? null
  };
}

/**
 * Create a candidate long-term memory.
 * Memories start as pending and are not returned by retrieval
 * until they have been reviewed and approved.
 */
export async function proposeMemory(
  env,
  userId,
  category,
  content,
  sourceMessageId = null
) {
  validateUserId(userId);

  const allowedCategories = [
    "preference",
    "interest",
    "milestone",
    "ongoing_topic",
    "communication_style",
    "other"
  ];

  if (!allowedCategories.includes(category)) {
    throw new Error("Unsupported memory category.");
  }

  if (typeof content !== "string" ||
      !content.trim() ||
      content.length > 2000) {
    throw new Error("Memory content is invalid or too long.");
  }

  const db = requireDB(env);
  const settings = await getSettings(env, userId);

  if (!settings || settings.memory_enabled !== 1) {
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
      throw new Error("Source message does not belong to this user.");
    }
  }

  const memoryId = crypto.randomUUID();

  await db.prepare(`
    INSERT INTO memories
      (memory_id, user_id, category, content, source_message_id)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    memoryId,
    userId,
    category,
    content.trim(),
    sourceMessageId
  ).run();

  return { saved: true, memoryId, reviewStatus: "pending" };
}

/**
 * Approve a proposed memory after review.
 */
export async function reviewMemory(env, userId, memoryId, approved) {
  validateUserId(userId);

  if (typeof approved !== "boolean") {
    throw new Error("Review decision must be true or false.");
  }

  const db = requireDB(env);

  const result = await db.prepare(`
    UPDATE memories
    SET review_status = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE memory_id = ? AND user_id = ?
      AND review_status = 'pending'
  `).bind(
    approved ? "approved" : "rejected",
    memoryId,
    userId
  ).run();

  return { updated: (result.meta?.changes ?? 0) > 0 };
}

/**
 * Retrieve only approved memories belonging to this user.
 */
export async function retrieveMemories(
  env,
  userId,
  category = null,
  limit = 10
) {
  validateUserId(userId);

  const safeLimit = Math.max(1, Math.min(20, Math.floor(limit)));
  const settings = await getSettings(env, userId);

  if (!settings || settings.memory_enabled !== 1) {
    return [];
  }

  const db = requireDB(env);

  if (category) {
    return db.prepare(`
      SELECT memory_id, category, content, created_at, updated_at
      FROM memories
      WHERE user_id = ?
        AND review_status = 'approved'
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        AND category = ?
      ORDER BY updated_at DESC
      LIMIT ?
    `).bind(userId, category, safeLimit).all()
      .then(result => result.results ?? []);
  }

  return db.prepare(`
    SELECT memory_id, category, content, created_at, updated_at
    FROM memories
    WHERE user_id = ?
      AND review_status = 'approved'
      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
    ORDER BY updated_at DESC
    LIMIT ?
  `).bind(userId, safeLimit).all()
    .then(result => result.results ?? []);
}
