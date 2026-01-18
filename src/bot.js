const parseCode = require("./utils/parseCode");
const isAdmin = require("./utils/isAdmin");
const Movie = require("./models/Movie");

const RATE_LIMIT_COUNT = 5;
const RATE_LIMIT_WINDOW_MS = 30 * 1000;
const rateLimits = new Map();

function isRateLimited(userId) {
  const now = Date.now();
  const entry = rateLimits.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT_COUNT;
}

function buildStartMessage() {
  return [
    "Salom! Kino kodini yuboring.",
    "Masalan: 184 yoki KOD: 184.",
    "Kanal postlaridagi KOD: <raqam> avtomatik indekslanadi.",
  ].join("\n");
}

function normalizeChannelId(value) {
  if (!value) {
    return "";
  }
  return String(value).trim();
}

module.exports = function setupBot(bot, { adminIds, channelId }) {
  const allowedChannelId = normalizeChannelId(channelId);

  async function handleChannelPost(msg) {
    if (!msg || !msg.chat) {
      return;
    }
    if (allowedChannelId && String(msg.chat.id) !== allowedChannelId) {
      return;
    }
    const text = msg.caption || msg.text || "";
    const code = parseCode(text);
    if (!code) {
      return;
    }
    await Movie.upsert({
      code,
      channelId: String(msg.chat.id),
      messageId: Number(msg.message_id),
    });
    console.log(`Indexed movie code ${code} from channel ${msg.chat.id}.`);
  }

  bot.on("channel_post", async (msg) => {
    try {
      await handleChannelPost(msg);
    } catch (err) {
      console.error("Channel post handler error:", err);
    }
  });

  bot.on("edited_channel_post", async (msg) => {
    try {
      await handleChannelPost(msg);
    } catch (err) {
      console.error("Edited channel post handler error:", err);
    }
  });

  bot.onText(/^\/start$/, async (msg) => {
    try {
      await bot.sendMessage(msg.chat.id, buildStartMessage());
    } catch (err) {
      console.error("Start handler error:", err);
    }
  });

  bot.onText(/^\/stats$/, async (msg) => {
    try {
      if (!isAdmin(msg.from && msg.from.id, adminIds)) {
        await bot.sendMessage(msg.chat.id, "Ruxsat yoq.");
        return;
      }
      const count = await Movie.countAll();
      await bot.sendMessage(msg.chat.id, `Indexlangan kinolar: ${count}`);
    } catch (err) {
      console.error("Stats handler error:", err);
    }
  });

  bot.onText(/^\/del\s+(\d+)$/, async (msg, match) => {
    try {
      if (!isAdmin(msg.from && msg.from.id, adminIds)) {
        await bot.sendMessage(msg.chat.id, "Ruxsat yoq.");
        return;
      }
      const code = Number(match[1]);
      const removed = await Movie.removeByCode(code);
      if (removed) {
        await bot.sendMessage(msg.chat.id, `Ochirildi: ${code}`);
      } else {
        await bot.sendMessage(msg.chat.id, "Bunday kod topilmadi.");
      }
    } catch (err) {
      console.error("Del handler error:", err);
    }
  });

  bot.onText(/^\/set\s+(\d+)\s+(\d+)$/, async (msg, match) => {
    try {
      if (!isAdmin(msg.from && msg.from.id, adminIds)) {
        await bot.sendMessage(msg.chat.id, "Ruxsat yoq.");
        return;
      }
      if (!allowedChannelId) {
        await bot.sendMessage(msg.chat.id, "CHANNEL_ID sozlanmagan.");
        return;
      }
      const code = Number(match[1]);
      const messageId = Number(match[2]);
      await Movie.upsert({
        code,
        channelId: allowedChannelId,
        messageId,
      });
      await bot.sendMessage(msg.chat.id, `Boglandi: ${code} -> ${messageId}`);
    } catch (err) {
      console.error("Set handler error:", err);
    }
  });

  bot.on("message", async (msg) => {
    try {
      if (!msg.text) {
        return;
      }
      if (msg.text.startsWith("/")) {
        return;
      }
      if (msg.chat && msg.chat.type !== "private") {
        return;
      }
      const code = parseCode(msg.text);
      if (!code) {
        return;
      }
      if (!isAdmin(msg.from && msg.from.id, adminIds)) {
        if (isRateLimited(msg.from && msg.from.id)) {
          await bot.sendMessage(
            msg.chat.id,
            "Limit oshdi. 30 soniyada 5 ta sorov."
          );
          return;
        }
      }
      const movie = await Movie.findByCode(code);
      if (!movie) {
        await bot.sendMessage(msg.chat.id, "Bunday kod topilmadi.");
        return;
      }
      await bot.copyMessage(
        msg.chat.id,
        Number(movie.channel_id),
        Number(movie.message_id)
      );
    } catch (err) {
      console.error("Message handler error:", err);
      try {
        await bot.sendMessage(msg.chat.id, "Xatolik yuz berdi. Qayta urining.");
      } catch (sendErr) {
        console.error("Failed to send error message:", sendErr);
      }
    }
  });
};
