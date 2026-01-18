const { Pool } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}

const PG_SSL = ["true", "1", "yes"].includes(
  String(process.env.PG_SSL || "").toLowerCase()
);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: PG_SSL ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  console.error("PostgreSQL pool error:", err.message);
});

async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS movie_index (
      code BIGINT PRIMARY KEY,
      channel_id BIGINT NOT NULL,
      message_id BIGINT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);
}

module.exports = {
  pool,
  query,
  initDb,
};
