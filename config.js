require("dotenv").config();

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required in environment variables.");
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required in environment variables.");
}

const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const BOT_USERNAME = process.env.BOT_USERNAME || "";
const ADMIN_CONTACT = process.env.ADMIN_CONTACT || "";
const WEBAPP_URL =
  process.env.WEBAPP_URL || process.env.RENDER_EXTERNAL_URL || "";
const APP_NAME = process.env.APP_NAME || "FX-VM";
const PG_SSL = ["true", "1", "yes"].includes(
  String(process.env.PG_SSL || "").toLowerCase()
);

const DEFAULT_SETTINGS = {
  referral_bonus: 100,
  mine_amount: 1,
  premium_mine_amount: 2,
  mine_cooldown_seconds: 60,
  payout_day: 15,
  premium_cost: 1000,
  premium_days: 30,
  drop_bonus_fx: 500,
  drop_premium_days: 7,
  uc_fx_rate: 1,
  web_mine_cooldown_seconds: 0,
};

module.exports = {
  BOT_TOKEN,
  DATABASE_URL,
  ADMIN_IDS,
  BOT_USERNAME,
  ADMIN_CONTACT,
  WEBAPP_URL,
  APP_NAME,
  PG_SSL,
  DEFAULT_SETTINGS,
};
