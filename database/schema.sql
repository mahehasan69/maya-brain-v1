
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS user_settings (
    user_id TEXT PRIMARY KEY,
    memory_enabled INTEGER NOT NULL DEFAULT 0
        CHECK (memory_enabled IN (0, 1)),
    history_enabled INTEGER NOT NULL DEFAULT 0
        CHECK (history_enabled IN (0, 1)),
    training_consent INTEGER NOT NULL DEFAULT 0
        CHECK (training_consent IN (0, 1)),
    retention_consent INTEGER NOT NULL DEFAULT 0
        CHECK (retention_consent IN (0, 1)),
    privacy_notice_version TEXT,
    retention_consent_at TEXT,
    retention_choice_at TEXT,
    training_choice_at TEXT,
    training_consent_at TEXT,
    consent_updated_at TEXT,
    retention_days INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversations (
    conversation_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TEXT,
    FOREIGN KEY (user_id)
        REFERENCES user_settings(user_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversations_user
    ON conversations(user_id, started_at);

CREATE TABLE IF NOT EXISTS messages (
    message_id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id)
        REFERENCES conversations(conversation_id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages(conversation_id, message_id);

CREATE TABLE IF NOT EXISTS memories (
    memory_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    source_message_id INTEGER,
    confidence REAL NOT NULL DEFAULT 0.8
        CHECK (confidence >= 0.0 AND confidence <= 1.0),
    review_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (review_status IN ('pending', 'approved', 'rejected')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT,
    FOREIGN KEY (user_id)
        REFERENCES user_settings(user_id)
        ON DELETE CASCADE,
    FOREIGN KEY (source_message_id)
        REFERENCES messages(message_id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_user_status
    ON memories(user_id, review_status, category);

CREATE TABLE IF NOT EXISTS feedback (
    feedback_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    conversation_id TEXT,
    rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    feedback_text TEXT,
    training_approved INTEGER NOT NULL DEFAULT 0
        CHECK (training_approved IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id)
        REFERENCES user_settings(user_id)
        ON DELETE CASCADE,
    FOREIGN KEY (conversation_id)
        REFERENCES conversations(conversation_id)
        ON DELETE SET NULL
);
