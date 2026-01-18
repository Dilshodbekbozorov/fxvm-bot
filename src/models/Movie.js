const db = require("../db");

async function upsert({ code, channelId, messageId }) {
  const createdAt = Date.now();
  const result = await db.query(
    `
      INSERT INTO movie_index (code, channel_id, message_id, created_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (code) DO UPDATE
      SET channel_id = EXCLUDED.channel_id,
          message_id = EXCLUDED.message_id,
          created_at = EXCLUDED.created_at
      RETURNING code, channel_id, message_id, created_at
    `,
    [code, channelId, messageId, createdAt]
  );
  return result.rows[0] || null;
}

async function findByCode(code) {
  const result = await db.query(
    "SELECT code, channel_id, message_id, created_at FROM movie_index WHERE code = $1",
    [code]
  );
  return result.rows[0] || null;
}

async function removeByCode(code) {
  const result = await db.query("DELETE FROM movie_index WHERE code = $1", [
    code,
  ]);
  return result.rowCount || 0;
}

async function countAll() {
  const result = await db.query("SELECT COUNT(*)::int AS count FROM movie_index");
  if (!result.rows[0]) {
    return 0;
  }
  return Number(result.rows[0].count) || 0;
}

module.exports = {
  upsert,
  findByCode,
  removeByCode,
  countAll,
};
