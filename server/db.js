const path = require("path");
const Database = require("better-sqlite3");

// SQLite persistence for the conversation + psychosocial record.
// One file, no server setup. Every message is stored with the emotion
// detected at the moment it was sent, so we accumulate a timestamped
// affect history that can later feed long-term analytics for clinicians.
const dbPath = path.resolve(__dirname, "adina.db");
const db = new Database(dbPath);

// WAL improves concurrent read/write behaviour and durability.
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT    NOT NULL,
    ts         TEXT    NOT NULL,            -- ISO timestamp
    role       TEXT    NOT NULL,            -- 'user' | 'assistant'
    content    TEXT    NOT NULL,
    emotion    TEXT,                        -- detected facial emotion (user turns)
    confidence REAL                         -- detection confidence 0..1
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_messages_ts      ON messages(ts);
`);

const insertStmt = db.prepare(`
  INSERT INTO messages (session_id, ts, role, content, emotion, confidence)
  VALUES (@session_id, @ts, @role, @content, @emotion, @confidence)
`);

// Persist a single message turn. Returns the new row id.
function logMessage({ sessionId, role, content, emotion, confidence }) {
  const info = insertStmt.run({
    session_id: sessionId || "default",
    ts: new Date().toISOString(),
    role,
    content: content == null ? "" : String(content),
    emotion: emotion ?? null,
    confidence: typeof confidence === "number" ? confidence : null,
  });
  return info.lastInsertRowid;
}

// Load recent messages for a session (oldest first) so the avatar can
// "remember" earlier conversation on startup.
const recentStmt = db.prepare(`
  SELECT role, content, emotion, confidence, ts
  FROM messages
  WHERE session_id = ?
  ORDER BY id DESC
  LIMIT ?
`);

function getRecentMessages(sessionId, limit = 50) {
  const rows = recentStmt.all(sessionId || "default", limit);
  return rows.reverse(); // return oldest -> newest
}

// Aggregate emotion counts over time — the raw substrate for the
// long-term psychosocial analytics ADiNA conveys to care staff.
const emotionStatsStmt = db.prepare(`
  SELECT emotion, COUNT(*) AS count, AVG(confidence) AS avg_confidence
  FROM messages
  WHERE role = 'user' AND emotion IS NOT NULL
    AND (@session_id IS NULL OR session_id = @session_id)
  GROUP BY emotion
  ORDER BY count DESC
`);

const emotionTimelineStmt = db.prepare(`
  SELECT ts, emotion, confidence
  FROM messages
  WHERE role = 'user' AND emotion IS NOT NULL
    AND (@session_id IS NULL OR session_id = @session_id)
  ORDER BY id ASC
`);

function getEmotionStats(sessionId) {
  const arg = { session_id: sessionId || null };
  return {
    distribution: emotionStatsStmt.all(arg),
    timeline: emotionTimelineStmt.all(arg),
  };
}

module.exports = { logMessage, getRecentMessages, getEmotionStats };
