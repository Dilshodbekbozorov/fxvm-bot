require("dotenv").config();

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const { initDb } = require("./db");
const setupBot = require("./bot");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required.");
}

const CHANNEL_ID = process.env.CHANNEL_ID;
if (!CHANNEL_ID) {
  throw new Error("CHANNEL_ID is required.");
}

const ADMIN_IDS = (process.env.ADMIN_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

function startHealthServer() {
  const app = express();
  app.get("/health", (req, res) => {
    res.json({ ok: true });
  });
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Health server listening on port ${port}`);
  });
}

async function start() {
  await initDb();

  const bot = new TelegramBot(BOT_TOKEN, { polling: false });
  setupBot(bot, { adminIds: ADMIN_IDS, channelId: CHANNEL_ID });

  try {
    await bot.deleteWebHook({ drop_pending_updates: false });
  } catch (err) {
    console.warn("Failed to delete webhook:", err.message);
  }

  await bot.startPolling();
  bot.on("polling_error", (err) => {
    console.error("Polling error:", err.message);
  });

  startHealthServer();
  console.log("Bot started.");
}

start().catch((err) => {
  console.error("Startup error:", err);
  process.exit(1);
});
