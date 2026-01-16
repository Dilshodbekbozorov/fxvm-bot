const { Pool } = require("pg");
const { DATABASE_URL, DEFAULT_SETTINGS, PG_SSL } = require("./config");

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: PG_SSL ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  console.error("PostgreSQL pool error:", err.message);
});

async function run(sql, params = []) {
  return pool.query(sql, params);
}

async function get(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0] || null;
}

async function all(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      created_at BIGINT NOT NULL,
      fx_balance BIGINT NOT NULL DEFAULT 0,
      premium_until BIGINT,
      referral_code TEXT UNIQUE,
      referred_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      referrals_count BIGINT NOT NULL DEFAULT 0,
      referral_fx BIGINT NOT NULL DEFAULT 0,
      last_mine_at BIGINT NOT NULL DEFAULT 0,
      total_mined BIGINT NOT NULL DEFAULT 0,
      is_banned SMALLINT NOT NULL DEFAULT 0
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS user_states (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      state TEXT NOT NULL,
      data TEXT,
      updated_at BIGINT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS withdraw_requests (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount BIGINT NOT NULL,
      card_type TEXT NOT NULL,
      card_number TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS uc_requests (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      uc_amount BIGINT NOT NULL,
      fx_cost BIGINT NOT NULL,
      status TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS movie_codes (
      code TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      content_value TEXT NOT NULL,
      channel_id BIGINT,
      channel_message_id BIGINT,
      created_at BIGINT NOT NULL,
      added_by BIGINT
    )
  `);

  await run(`ALTER TABLE movie_codes ADD COLUMN IF NOT EXISTS channel_id BIGINT`);
  await run(
    `ALTER TABLE movie_codes ADD COLUMN IF NOT EXISTS channel_message_id BIGINT`
  );

  await run(`
    CREATE TABLE IF NOT EXISTS drops (
      id BIGSERIAL PRIMARY KEY,
      month INT NOT NULL,
      year INT NOT NULL,
      processed_at BIGINT NOT NULL,
      notes TEXT
    )
  `);

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await run(
      "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
      [key, String(value)]
    );
  }
}

async function getSetting(key) {
  const row = await get("SELECT value FROM settings WHERE key = $1", [key]);
  return row ? row.value : null;
}

async function getSettingNumber(key) {
  const value = await getSetting(key);
  if (value === null || value === undefined) {
    return null;
  }
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

async function setSetting(key, value) {
  await run(
    `INSERT INTO settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)]
  );
}

async function getUserById(userId) {
  return get("SELECT * FROM users WHERE id = $1", [userId]);
}

async function getUserByReferralCode(code) {
  return get("SELECT * FROM users WHERE referral_code = $1", [code]);
}

async function createUser({
  id,
  username,
  first_name,
  last_name,
  referral_code,
}) {
  const now = Date.now();
  await run(
    `INSERT INTO users
      (id, username, first_name, last_name, created_at, referral_code)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, username || null, first_name || null, last_name || null, now, referral_code]
  );
}

async function updateUserIdentity({ id, username, first_name, last_name }) {
  await run(
    `UPDATE users
     SET username = $1, first_name = $2, last_name = $3
     WHERE id = $4`,
    [username || null, first_name || null, last_name || null, id]
  );
}

async function addUserBalance(userId, amount) {
  await run(
    `UPDATE users SET fx_balance = fx_balance + $1 WHERE id = $2`,
    [amount, userId]
  );
}

async function setUserPremiumUntil(userId, premiumUntil) {
  await run(`UPDATE users SET premium_until = $1 WHERE id = $2`, [
    premiumUntil,
    userId,
  ]);
}

async function updateUserMining(userId, amount, minedAt) {
  await run(
    `UPDATE users
     SET fx_balance = fx_balance + $1,
         last_mine_at = $2,
         total_mined = total_mined + $3
     WHERE id = $4`,
    [amount, minedAt, amount, userId]
  );
}

async function setUserReferredBy(userId, referrerId) {
  await run(`UPDATE users SET referred_by = $1 WHERE id = $2`, [
    referrerId,
    userId,
  ]);
}

async function incrementReferralStats(referrerId, bonus) {
  await run(
    `UPDATE users
     SET fx_balance = fx_balance + $1,
         referrals_count = referrals_count + 1,
         referral_fx = referral_fx + $2
     WHERE id = $3`,
    [bonus, bonus, referrerId]
  );
}

async function getUserRankByBalance(balance) {
  const row = await get(
    "SELECT COUNT(*)::int + 1 AS rank FROM users WHERE fx_balance > $1",
    [balance]
  );
  return row ? Number(row.rank) : 1;
}

async function getTopUsers(limit = 10) {
  return all(
    `SELECT id, username, first_name, last_name, fx_balance, premium_until
     FROM users
     ORDER BY fx_balance DESC, id ASC
     LIMIT $1`,
    [limit]
  );
}

async function getAllUserIds() {
  return all(`SELECT id FROM users`);
}

async function getStats() {
  const row = await get(
    `SELECT COUNT(*)::int AS user_count, COALESCE(SUM(fx_balance), 0) AS total_fx FROM users`
  );
  return {
    user_count: row ? Number(row.user_count) : 0,
    total_fx: row ? Number(row.total_fx) : 0,
  };
}

async function setUserState(userId, state, data = null) {
  const now = Date.now();
  const payload = data ? JSON.stringify(data) : null;
  await run(
    `INSERT INTO user_states (user_id, state, data, updated_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET state = EXCLUDED.state, data = EXCLUDED.data, updated_at = EXCLUDED.updated_at`,
    [userId, state, payload, now]
  );
}

async function getUserState(userId) {
  const row = await get(
    `SELECT state, data FROM user_states WHERE user_id = $1`,
    [userId]
  );
  if (!row) {
    return null;
  }
  let data = null;
  if (row.data) {
    try {
      data = JSON.parse(row.data);
    } catch (err) {
      data = null;
    }
  }
  return { state: row.state, data };
}

async function clearUserState(userId) {
  await run(`DELETE FROM user_states WHERE user_id = $1`, [userId]);
}

async function createWithdrawRequest({
  user_id,
  amount,
  card_type,
  card_number,
}) {
  const now = Date.now();
  const result = await run(
    `INSERT INTO withdraw_requests
     (user_id, amount, card_type, card_number, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6)
     RETURNING id`,
    [user_id, amount, card_type, card_number, now, now]
  );
  return result.rows[0].id;
}

async function updateWithdrawStatus(id, status) {
  const now = Date.now();
  await run(
    `UPDATE withdraw_requests SET status = $1, updated_at = $2 WHERE id = $3`,
    [status, now, id]
  );
}

async function getWithdrawRequestById(id) {
  return get(`SELECT * FROM withdraw_requests WHERE id = $1`, [id]);
}

async function getPendingWithdrawRequests() {
  return all(
    `SELECT * FROM withdraw_requests WHERE status = 'pending' ORDER BY created_at ASC`
  );
}

async function createUcRequest({ user_id, uc_amount, fx_cost }) {
  const now = Date.now();
  const result = await run(
    `INSERT INTO uc_requests
     (user_id, uc_amount, fx_cost, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'pending', $4, $5)
     RETURNING id`,
    [user_id, uc_amount, fx_cost, now, now]
  );
  return result.rows[0].id;
}

async function updateUcStatus(id, status) {
  const now = Date.now();
  await run(`UPDATE uc_requests SET status = $1, updated_at = $2 WHERE id = $3`, [
    status,
    now,
    id,
  ]);
}

async function getUcRequestById(id) {
  return get(`SELECT * FROM uc_requests WHERE id = $1`, [id]);
}

async function getPendingUcRequests() {
  return all(
    `SELECT * FROM uc_requests WHERE status = 'pending' ORDER BY created_at ASC`
  );
}

async function addMovieCode({
  code,
  content_type,
  content_value,
  added_by,
  channel_id,
  channel_message_id,
}) {
  const now = Date.now();
  const value = content_value || "";
  await run(
    `INSERT INTO movie_codes
     (code, content_type, content_value, created_at, added_by, channel_id, channel_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (code) DO UPDATE
     SET content_type = EXCLUDED.content_type,
         content_value = EXCLUDED.content_value,
         created_at = EXCLUDED.created_at,
         added_by = EXCLUDED.added_by,
         channel_id = EXCLUDED.channel_id,
         channel_message_id = EXCLUDED.channel_message_id`,
    [
      code,
      content_type,
      value,
      now,
      added_by || null,
      channel_id || null,
      channel_message_id || null,
    ]
  );
}

async function deleteMovieCode(code) {
  await run(`DELETE FROM movie_codes WHERE code = $1`, [code]);
}

async function getMovieCode(code) {
  return get(`SELECT * FROM movie_codes WHERE code = $1`, [code]);
}

async function getNextMovieCode() {
  const row = await get(
    "SELECT MAX(CAST(code AS BIGINT)) AS max_code FROM movie_codes WHERE code ~ '^[0-9]+$'"
  );
  const maxCode = row && row.max_code ? Number(row.max_code) : 0;
  return String(maxCode + 1);
}

async function addDropRecord({ month, year, notes }) {
  const now = Date.now();
  await run(
    `INSERT INTO drops (month, year, processed_at, notes)
     VALUES ($1, $2, $3, $4)`,
    [month, year, now, notes || null]
  );
}

async function getDropRecord(month, year) {
  return get(`SELECT * FROM drops WHERE month = $1 AND year = $2`, [
    month,
    year,
  ]);
}

module.exports = {
  db: pool,
  run,
  get,
  all,
  initDb,
  getSetting,
  getSettingNumber,
  setSetting,
  getUserById,
  getUserByReferralCode,
  createUser,
  updateUserIdentity,
  addUserBalance,
  setUserPremiumUntil,
  updateUserMining,
  setUserReferredBy,
  incrementReferralStats,
  getUserRankByBalance,
  getTopUsers,
  getAllUserIds,
  getStats,
  setUserState,
  getUserState,
  clearUserState,
  createWithdrawRequest,
  updateWithdrawStatus,
  getWithdrawRequestById,
  getPendingWithdrawRequests,
  createUcRequest,
  updateUcStatus,
  getUcRequestById,
  getPendingUcRequests,
  addMovieCode,
  deleteMovieCode,
  getMovieCode,
  getNextMovieCode,
  addDropRecord,
  getDropRecord,
};
