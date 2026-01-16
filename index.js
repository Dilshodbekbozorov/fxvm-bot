const crypto = require("crypto");
const path = require("path");
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const config = require("./config");
const db = require("./db");

function normalizeWebhookUrl(rawUrl) {
  if (!rawUrl) {
    return "";
  }
  try {
    const url = new URL(rawUrl);
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/telegram/webhook";
    }
    return url.toString();
  } catch (err) {
    return rawUrl;
  }
}

const WEBHOOK_URL = normalizeWebhookUrl(config.WEBHOOK_URL);
const USE_WEBHOOK = Boolean(WEBHOOK_URL);
const bot = new TelegramBot(config.BOT_TOKEN, { polling: false });

let botUsername = config.BOT_USERNAME;

function getBackendBaseUrl() {
  if (WEBHOOK_URL) {
    const webhook = WEBHOOK_URL.replace(/\/$/, "");
    if (webhook.endsWith("/telegram/webhook")) {
      return webhook.replace(/\/telegram\/webhook$/, "");
    }
    return webhook;
  }
  if (process.env.RENDER_EXTERNAL_URL) {
    return process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "");
  }
  return "";
}

function getWebAppUrl() {
  if (!config.WEBAPP_URL) {
    return "";
  }
  const backendBase = getBackendBaseUrl();
  if (!backendBase) {
    return config.WEBAPP_URL;
  }
  try {
    const url = new URL(config.WEBAPP_URL);
    if (!url.searchParams.get("api")) {
      url.searchParams.set("api", backendBase);
    }
    return url.toString();
  } catch (err) {
    return config.WEBAPP_URL;
  }
}

function buildMainMenuKeyboard() {
  const webAppUrl = getWebAppUrl();
  const rows = [
    ["Mining", "Profil"],
    ["Referral", "Premium"],
    ["Kino kodi", "Reyting"],
    ["Pul kiritish/chiqarish", "UC xarid"],
  ];
  if (webAppUrl) {
    rows.unshift([{ text: "Web Mining", web_app: { url: webAppUrl } }]);
  }
  return {
    reply_markup: {
      keyboard: rows,
      resize_keyboard: true,
    },
  };
}

const MAIN_MENU_KEYBOARD = buildMainMenuKeyboard();

const CANCEL_KEYBOARD = {
  reply_markup: {
    keyboard: [["Bekor qilish"]],
    resize_keyboard: true,
    one_time_keyboard: true,
  },
};

function isAdmin(userId) {
  return config.ADMIN_IDS.includes(String(userId));
}

function displayName(user) {
  if (!user) {
    return "Noma'lum";
  }
  if (user.username) {
    return `@${user.username}`;
  }
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return name || `ID:${user.id}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function isPremium(user) {
  if (!user || !user.premium_until) {
    return false;
  }
  return user.premium_until > Date.now();
}

function formatDateTime(timestamp) {
  if (!timestamp) {
    return "-";
  }
  const date = new Date(timestamp);
  return `${date.toLocaleDateString("en-GB")} ${date.toLocaleTimeString(
    "en-GB",
    { hour: "2-digit", minute: "2-digit" }
  )}`;
}

function secondsToHuman(seconds) {
  if (seconds <= 0) {
    return "0s";
  }
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${restSeconds}s`;
  }
  return `${restSeconds}s`;
}

const WEBAPP_AUTH_MAX_AGE_SECONDS = 24 * 60 * 60;

function parseInitData(initData) {
  const params = new URLSearchParams(initData);
  const data = {};
  for (const [key, value] of params.entries()) {
    data[key] = value;
  }
  if (data.user) {
    try {
      data.user = JSON.parse(data.user);
    } catch (err) {
      data.user = null;
    }
  }
  return data;
}

function verifyInitData(initData) {
  if (!initData) {
    return false;
  }
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    return false;
  }
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate) {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > WEBAPP_AUTH_MAX_AGE_SECONDS) {
    return false;
  }
  params.delete("hash");
  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(config.BOT_TOKEN)
    .digest();
  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  const hashBuffer = Buffer.from(hash, "hex");
  const calcBuffer = Buffer.from(calculatedHash, "hex");
  if (hashBuffer.length !== calcBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(hashBuffer, calcBuffer);
}

async function ensureUser(tgUser) {
  let user = await db.getUserById(tgUser.id);
  if (!user) {
    const referralCode = await generateUniqueReferralCode();
    await db.createUser({
      id: tgUser.id,
      username: tgUser.username,
      first_name: tgUser.first_name,
      last_name: tgUser.last_name,
      referral_code: referralCode,
    });
    user = await db.getUserById(tgUser.id);
    return { user, isNew: true };
  }

  await db.updateUserIdentity({
    id: tgUser.id,
    username: tgUser.username,
    first_name: tgUser.first_name,
    last_name: tgUser.last_name,
  });

  return { user, isNew: false };
}

async function getUserFromInitData(initData) {
  const parsed = parseInitData(initData);
  if (!parsed.user || !parsed.user.id) {
    return null;
  }
  await ensureUser(parsed.user);
  return db.getUserById(parsed.user.id);
}

async function getCooldownSeconds(source) {
  if (source === "web") {
    const webCooldown = await db.getSettingNumber(
      "web_mine_cooldown_seconds"
    );
    if (webCooldown !== null && webCooldown !== undefined) {
      return webCooldown;
    }
    return 0;
  }
  const cooldown = await db.getSettingNumber("mine_cooldown_seconds");
  return cooldown !== null && cooldown !== undefined ? cooldown : 60;
}

async function getMineAmount(source, user) {
  if (source === "web") {
    const webAmount = await db.getSettingNumber("web_mine_amount");
    if (webAmount !== null && webAmount !== undefined) {
      return webAmount;
    }
    return 1;
  }
  const mineAmount = isPremium(user)
    ? await db.getSettingNumber("premium_mine_amount")
    : await db.getSettingNumber("mine_amount");
  return mineAmount || 1;
}

async function mineForUser(userId, source = "bot") {
  const user = await db.getUserById(userId);
  if (!user) {
    return { ok: false, error: "user_not_found" };
  }
  const cooldown = await getCooldownSeconds(source);
  const now = Date.now();
  const lastMine = user.last_mine_at || 0;
  const diffSeconds = Math.max(0, Math.floor((now - lastMine) / 1000));

  if (diffSeconds < cooldown) {
    return {
      ok: false,
      remainingSeconds: cooldown - diffSeconds,
      cooldownSeconds: cooldown,
      balance: user.fx_balance,
      premium: isPremium(user),
    };
  }

  const amount = await getMineAmount(source, user);

  await db.updateUserMining(user.id, amount, now);
  const updated = await db.getUserById(user.id);

  return {
    ok: true,
    amount,
    balance: updated.fx_balance,
    cooldownSeconds: cooldown,
    premium: isPremium(updated),
  };
}

async function generateUniqueReferralCode() {
  while (true) {
    const code = crypto.randomBytes(4).toString("hex").toUpperCase();
    const existing = await db.getUserByReferralCode(code);
    if (!existing) {
      return code;
    }
  }
}

async function getReferralLink(user) {
  if (!botUsername) {
    return `Referral kod: ${user.referral_code}`;
  }
  return `https://t.me/${botUsername}?start=${user.referral_code}`;
}

async function applyReferralIfAny(user, refCode) {
  if (!refCode || user.referred_by) {
    return null;
  }
  const referrer = await db.getUserByReferralCode(refCode);
  if (!referrer || referrer.id === user.id) {
    return null;
  }
  const bonus = await db.getSettingNumber("referral_bonus");
  await db.setUserReferredBy(user.id, referrer.id);
  await db.incrementReferralStats(referrer.id, bonus || 0);
  return referrer;
}

async function sendMainMenu(chatId) {
  await bot.sendMessage(chatId, "Asosiy menyu:", MAIN_MENU_KEYBOARD);
}

async function sendProfile(chatId, user) {
  const rank = await db.getUserRankByBalance(user.fx_balance);
  const referralLink = await getReferralLink(user);
  const premiumStatus = isPremium(user)
    ? `Faol (tugash: ${formatDateTime(user.premium_until)})`
    : "Faol emas";

  const text = [
    `ID: ${user.id}`,
    `FX balans: ${formatNumber(user.fx_balance)}`,
    `Premium: ${premiumStatus}`,
    `Reyting: #${rank}`,
    `Referral link: ${referralLink}`,
    `Referral soni: ${user.referrals_count}`,
    `Referral FX: ${formatNumber(user.referral_fx)}`,
  ].join("\n");

  await bot.sendMessage(chatId, text, MAIN_MENU_KEYBOARD);
}

async function handleMining(chatId, user) {
  const result = await mineForUser(user.id, "bot");
  if (!result.ok) {
    await bot.sendMessage(
      chatId,
      `Keyingi mining uchun ${secondsToHuman(
        result.remainingSeconds || 0
      )} kuting.`,
      MAIN_MENU_KEYBOARD
    );
    return;
  }
  await bot.sendMessage(
    chatId,
    `+${result.amount} FX. Jami balans: ${formatNumber(result.balance)} FX`,
    MAIN_MENU_KEYBOARD
  );
}

async function handleReferralInfo(chatId, user) {
  const link = await getReferralLink(user);
  const text = [
    "Referral tizimi:",
    `Link: ${link}`,
    `Jami referral: ${user.referrals_count}`,
    `Referral bonus: ${formatNumber(user.referral_fx)} FX`,
  ].join("\n");
  await bot.sendMessage(chatId, text, MAIN_MENU_KEYBOARD);
}

async function handlePremiumInfo(chatId, user) {
  const cost = (await db.getSettingNumber("premium_cost")) || 0;
  const days = (await db.getSettingNumber("premium_days")) || 30;
  const status = isPremium(user)
    ? `Faol (tugash: ${formatDateTime(user.premium_until)})`
    : "Faol emas";

  const text = [
    `Premium status: ${status}`,
    `Narx: ${formatNumber(cost)} FX`,
    `Muddati: ${days} kun`,
    "Premium olish uchun: Premium sotib olish deb yozing.",
  ].join("\n");

  await bot.sendMessage(chatId, text, MAIN_MENU_KEYBOARD);
}

async function handlePremiumPurchase(chatId, user) {
  const cost = (await db.getSettingNumber("premium_cost")) || 0;
  const days = (await db.getSettingNumber("premium_days")) || 30;

  if (user.fx_balance < cost) {
    await bot.sendMessage(
      chatId,
      "Balans yetarli emas. Pul kiritish/chiqarish bo'limidan balansni to'ldiring.",
      MAIN_MENU_KEYBOARD
    );
    return;
  }

  const now = Date.now();
  const base = user.premium_until && user.premium_until > now ? user.premium_until : now;
  const newUntil = base + days * 24 * 60 * 60 * 1000;

  await db.addUserBalance(user.id, -cost);
  await db.setUserPremiumUntil(user.id, newUntil);

  const updated = await db.getUserById(user.id);
  await bot.sendMessage(
    chatId,
    `Premium faollashtirildi. Tugash vaqti: ${formatDateTime(
      updated.premium_until
    )}`,
    MAIN_MENU_KEYBOARD
  );
}

async function handleTopUsers(chatId) {
  const top = await db.getTopUsers(10);
  if (!top.length) {
    await bot.sendMessage(chatId, "Reytingda foydalanuvchi yo'q.", MAIN_MENU_KEYBOARD);
    return;
  }
  const lines = top.map((u, index) => {
    return `${index + 1}. ${displayName(u)} - ${formatNumber(u.fx_balance)} FX`;
  });
  await bot.sendMessage(chatId, `Top 10:\n${lines.join("\n")}`, MAIN_MENU_KEYBOARD);
}

async function handlePayoutInfo(chatId) {
  const day = (await db.getSettingNumber("payout_day")) || 15;
  const text = [
    "Pul kiritish/chiqarish:",
    `Pul chiqarish faqat oyning ${day}-sanasi.`,
    "Pul kiritish uchun admin bilan bog'laning.",
    "Pul chiqarish uchun: Pul chiqarish deb yozing.",
  ].join("\n");
  await bot.sendMessage(chatId, text, {
    reply_markup: {
      keyboard: [["Pul chiqarish", "Balans to'ldirish"], ["Menu"]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

async function startWithdrawFlow(chatId, user) {
  const day = (await db.getSettingNumber("payout_day")) || 15;
  const today = new Date().getDate();
  if (today !== day && !isAdmin(user.id)) {
    await bot.sendMessage(
      chatId,
      `Pul chiqarish faqat oyning ${day}-sanasi.`,
      MAIN_MENU_KEYBOARD
    );
    return;
  }
  await db.setUserState(user.id, "withdraw_amount");
  await bot.sendMessage(
    chatId,
    "Yechmoqchi bo'lgan FX miqdorini kiriting:",
    CANCEL_KEYBOARD
  );
}

async function startUcFlow(chatId, user) {
  await db.setUserState(user.id, "uc_amount");
  await bot.sendMessage(
    chatId,
    "Necha UC kerak? (masalan: 60)",
    CANCEL_KEYBOARD
  );
}

async function startMovieFlow(chatId, user) {
  await db.setUserState(user.id, "movie_code");
  await bot.sendMessage(chatId, "Kino kodini kiriting:", CANCEL_KEYBOARD);
}

async function handleStateMessage(msg, user) {
  const state = await db.getUserState(user.id);
  if (!state) {
    return false;
  }

  const text = (msg.text || "").trim();
  if (text.toLowerCase() === "bekor qilish") {
    await db.clearUserState(user.id);
    await bot.sendMessage(msg.chat.id, "Bekor qilindi.", MAIN_MENU_KEYBOARD);
    return true;
  }

  switch (state.state) {
    case "withdraw_amount": {
      const amount = parseInt(text, 10);
      if (!Number.isFinite(amount) || amount <= 0) {
        await bot.sendMessage(msg.chat.id, "Miqdor noto'g'ri. Qayta kiriting:", CANCEL_KEYBOARD);
        return true;
      }
      if (amount > user.fx_balance) {
        await bot.sendMessage(
          msg.chat.id,
          "Balans yetarli emas. Qayta kiriting:",
          CANCEL_KEYBOARD
        );
        return true;
      }
      await db.setUserState(user.id, "withdraw_card_type", { amount });
      await bot.sendMessage(
        msg.chat.id,
        "Karta turini tanlang (UZCARD yoki HUMO):",
        {
          reply_markup: {
            keyboard: [["UZCARD", "HUMO"], ["Bekor qilish"]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }
      );
      return true;
    }
    case "withdraw_card_type": {
      const cardType = text.toUpperCase();
      if (!["UZCARD", "HUMO"].includes(cardType)) {
        await bot.sendMessage(
          msg.chat.id,
          "Karta turi noto'g'ri. UZCARD yoki HUMO kiriting:",
          CANCEL_KEYBOARD
        );
        return true;
      }
      await db.setUserState(user.id, "withdraw_card_number", {
        amount: state.data.amount,
        card_type: cardType,
      });
      await bot.sendMessage(
        msg.chat.id,
        "Karta raqamini kiriting (16 ta raqam):",
        CANCEL_KEYBOARD
      );
      return true;
    }
    case "withdraw_card_number": {
      const raw = text.replace(/\s+/g, "");
      if (!/^\d{16}$/.test(raw)) {
        await bot.sendMessage(
          msg.chat.id,
          "Karta raqami noto'g'ri. Qayta kiriting:",
          CANCEL_KEYBOARD
        );
        return true;
      }
      const amount = state.data.amount;
      const cardType = state.data.card_type;
      await db.clearUserState(user.id);

      try {
        await db.addUserBalance(user.id, -amount);
        const requestId = await db.createWithdrawRequest({
          user_id: user.id,
          amount,
          card_type: cardType,
          card_number: raw,
        });

        await bot.sendMessage(
          msg.chat.id,
          `Pul chiqarish so'rovi qabul qilindi. ID: ${requestId}`,
          MAIN_MENU_KEYBOARD
        );

        for (const adminId of config.ADMIN_IDS) {
          await bot.sendMessage(
            adminId,
            `Yangi pul chiqarish so'rovi:\nID: ${requestId}\nUser: ${displayName(
              user
            )}\nMiqdor: ${amount} FX\nKarta: ${cardType} ${raw}`
          );
        }
      } catch (err) {
        await db.addUserBalance(user.id, amount);
        await bot.sendMessage(
          msg.chat.id,
          "Xatolik yuz berdi. Qayta urinib ko'ring.",
          MAIN_MENU_KEYBOARD
        );
      }
      return true;
    }
    case "uc_amount": {
      const ucAmount = parseInt(text, 10);
      if (!Number.isFinite(ucAmount) || ucAmount <= 0) {
        await bot.sendMessage(
          msg.chat.id,
          "UC miqdori noto'g'ri. Qayta kiriting:",
          CANCEL_KEYBOARD
        );
        return true;
      }
      const rate = (await db.getSettingNumber("uc_fx_rate")) || 1;
      const fxCost = ucAmount * rate;
      if (user.fx_balance < fxCost) {
        await bot.sendMessage(
          msg.chat.id,
          `Balans yetarli emas. Kerak: ${formatNumber(
            fxCost
          )} FX, sizda: ${formatNumber(user.fx_balance)} FX`,
          MAIN_MENU_KEYBOARD
        );
        await db.clearUserState(user.id);
        return true;
      }
      await db.setUserState(user.id, "uc_confirm", {
        uc_amount: ucAmount,
        fx_cost: fxCost,
      });
      await bot.sendMessage(
        msg.chat.id,
        `UC: ${ucAmount}\nNarx: ${formatNumber(
          fxCost
        )} FX\nTasdiqlaysizmi? (Ha/Yoq)`,
        {
          reply_markup: {
            keyboard: [["Ha", "Yoq"], ["Bekor qilish"]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        }
      );
      return true;
    }
    case "uc_confirm": {
      const answer = text.toLowerCase();
      if (answer === "ha") {
        const { uc_amount: ucAmount, fx_cost: fxCost } = state.data;
        await db.clearUserState(user.id);
        try {
          await db.addUserBalance(user.id, -fxCost);
          const requestId = await db.createUcRequest({
            user_id: user.id,
            uc_amount: ucAmount,
            fx_cost: fxCost,
          });
          await bot.sendMessage(
            msg.chat.id,
            `UC so'rovi qabul qilindi. ID: ${requestId}`,
            MAIN_MENU_KEYBOARD
          );
          for (const adminId of config.ADMIN_IDS) {
            await bot.sendMessage(
              adminId,
              `Yangi UC so'rovi:\nID: ${requestId}\nUser: ${displayName(
                user
              )}\nUC: ${ucAmount}\nNarx: ${fxCost} FX`
            );
          }
        } catch (err) {
          await db.addUserBalance(user.id, fxCost);
          await bot.sendMessage(
            msg.chat.id,
            "Xatolik yuz berdi. Qayta urinib ko'ring.",
            MAIN_MENU_KEYBOARD
          );
        }
        return true;
      }
      if (answer === "yoq") {
        await db.clearUserState(user.id);
        await bot.sendMessage(msg.chat.id, "Bekor qilindi.", MAIN_MENU_KEYBOARD);
        return true;
      }
      await bot.sendMessage(
        msg.chat.id,
        "Iltimos, Ha yoki Yoq deb javob bering.",
        CANCEL_KEYBOARD
      );
      return true;
    }
    case "movie_code": {
      const code = text.trim();
      const movie = await db.getMovieCode(code);
      await db.clearUserState(user.id);
      if (!movie) {
        await bot.sendMessage(
          msg.chat.id,
          "Kino kodi topilmadi.",
          MAIN_MENU_KEYBOARD
        );
        return true;
      }
      if (!isPremium(user)) {
        await bot.sendMessage(msg.chat.id, "Reklama: Premium bilan reklamasiz tomosha qiling.");
      }
      await sendMovieContent(msg.chat.id, movie);
      return true;
    }
    default:
      await db.clearUserState(user.id);
      return false;
  }
}

async function sendMovieContent(chatId, movie) {
  const type = movie.content_type;
  const value = movie.content_value;
  switch (type) {
    case "text":
      await bot.sendMessage(chatId, value, MAIN_MENU_KEYBOARD);
      break;
    case "channel": {
      if (!movie.channel_id || !movie.channel_message_id) {
        await bot.sendMessage(
          chatId,
          "Kino manbasi topilmadi. Admin bilan bog'laning.",
          MAIN_MENU_KEYBOARD
        );
        break;
      }
      try {
        await bot.copyMessage(
          chatId,
          movie.channel_id,
          movie.channel_message_id
        );
      } catch (err) {
        await bot.sendMessage(
          chatId,
          "Kino yuborib bo'lmadi. Kanalga ruxsat borligini tekshiring.",
          MAIN_MENU_KEYBOARD
        );
      }
      break;
    }
    case "video":
      await bot.sendVideo(chatId, value);
      break;
    case "photo":
      await bot.sendPhoto(chatId, value);
      break;
    case "document":
      await bot.sendDocument(chatId, value);
      break;
    case "audio":
      await bot.sendAudio(chatId, value);
      break;
    default:
      await bot.sendMessage(chatId, value, MAIN_MENU_KEYBOARD);
  }
}

function getInitDataFromRequest(req) {
  return (req.body && req.body.initData) || req.headers["x-telegram-init-data"] || "";
}

function startWebServer() {
  const app = express();
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, X-Telegram-Init-Data"
    );
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(path.join(__dirname, "public")));

  app.get("/health", (req, res) => {
    res.json({ ok: true });
  });

  if (USE_WEBHOOK) {
    const webhookHandler = (req, res) => {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    };
    app.post("/", webhookHandler);
    app.post("/webhook", webhookHandler);
    app.post("/telegram/webhook", (req, res) => {
      webhookHandler(req, res);
    });
  }

  app.post("/api/profile", async (req, res) => {
    const initData = getInitDataFromRequest(req);
    if (!verifyInitData(initData)) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    const user = await getUserFromInitData(initData);
    if (!user) {
      res.status(400).json({ ok: false, error: "user_missing" });
      return;
    }
    const cooldown = await getCooldownSeconds("web");
    const now = Date.now();
    const lastMine = user.last_mine_at || 0;
    const diffSeconds = Math.max(0, Math.floor((now - lastMine) / 1000));
    const remainingSeconds = Math.max(0, cooldown - diffSeconds);

    res.json({
      ok: true,
      user: {
        id: user.id,
        username: user.username || null,
        first_name: user.first_name || null,
        last_name: user.last_name || null,
      },
      balance: user.fx_balance,
      premium: isPremium(user),
      cooldownSeconds: cooldown,
      remainingSeconds,
      lastMineAt: user.last_mine_at,
    });
  });

  app.post("/api/mine", async (req, res) => {
    const initData = getInitDataFromRequest(req);
    if (!verifyInitData(initData)) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }
    const user = await getUserFromInitData(initData);
    if (!user) {
      res.status(400).json({ ok: false, error: "user_missing" });
      return;
    }
    const result = await mineForUser(user.id, "web");
    if (!result.ok) {
      res.json({
        ok: false,
        remainingSeconds: result.remainingSeconds || 0,
        cooldownSeconds: result.cooldownSeconds || 0,
        balance: result.balance || user.fx_balance,
        premium: result.premium || false,
      });
      return;
    }
    res.json({
      ok: true,
      mined: result.amount,
      balance: result.balance,
      cooldownSeconds: result.cooldownSeconds || 0,
      premium: result.premium || false,
    });
  });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Web server listening on port ${port}`);
  });
}

async function handleAdminSettingsList(chatId) {
  const keys = Object.keys(config.DEFAULT_SETTINGS);
  const lines = [];
  for (const key of keys) {
    const value = await db.getSetting(key);
    lines.push(`${key} = ${value}`);
  }
  await bot.sendMessage(chatId, lines.join("\n") || "Sozlamalar topilmadi.");
}

async function handleAdminWithdrawList(chatId) {
  const pending = await db.getPendingWithdrawRequests();
  if (!pending.length) {
    await bot.sendMessage(chatId, "Pending so'rov yo'q.");
    return;
  }
  const lines = [];
  for (const req of pending) {
    const user = await db.getUserById(req.user_id);
    lines.push(
      `ID:${req.id} | ${displayName(user)} | ${req.amount} FX | ${req.card_type} ${req.card_number}`
    );
  }
  await bot.sendMessage(chatId, lines.join("\n"));
}

async function handleAdminUcList(chatId) {
  const pending = await db.getPendingUcRequests();
  if (!pending.length) {
    await bot.sendMessage(chatId, "Pending UC so'rov yo'q.");
    return;
  }
  const lines = [];
  for (const req of pending) {
    const user = await db.getUserById(req.user_id);
    lines.push(
      `ID:${req.id} | ${displayName(user)} | UC:${req.uc_amount} | ${req.fx_cost} FX`
    );
  }
  await bot.sendMessage(chatId, lines.join("\n"));
}

function extractMovieContentFromReply(reply) {
  if (!reply) {
    return null;
  }
  if (
    reply.forward_from_chat &&
    reply.forward_from_chat.type === "channel" &&
    reply.forward_from_message_id
  ) {
    return {
      type: "channel",
      value: "channel",
      channel_id: reply.forward_from_chat.id,
      channel_message_id: reply.forward_from_message_id,
    };
  }
  if (reply.video) {
    return { type: "video", value: reply.video.file_id };
  }
  if (reply.photo && reply.photo.length) {
    const photo = reply.photo[reply.photo.length - 1];
    return { type: "photo", value: photo.file_id };
  }
  if (reply.document) {
    return { type: "document", value: reply.document.file_id };
  }
  if (reply.audio) {
    return { type: "audio", value: reply.audio.file_id };
  }
  if (reply.text) {
    return { type: "text", value: reply.text };
  }
  return null;
}

bot.onText(/\/start(?:\s+(\S+))?/, async (msg, match) => {
  const { user, isNew } = await ensureUser(msg.from);
  const refCode = match && match[1] ? match[1].trim() : null;
  const referrer = isNew ? await applyReferralIfAny(user, refCode) : null;

  let text = `Xush kelibsiz, ${displayName(user)}!\nFX-VM bot ishga tushdi.`;
  if (referrer) {
    text += `\nReferral qabul qilindi. Bonus: ${formatNumber(
      await db.getSettingNumber("referral_bonus")
    )} FX.`;
  }
  await bot.sendMessage(msg.chat.id, text, MAIN_MENU_KEYBOARD);
});

bot.onText(/\/help/, async (msg) => {
  const commands = [
    "Asosiy buyruqlar:",
    "/start - start",
    "/help - yordam",
  ];
  if (config.WEBAPP_URL) {
    commands.push("/web - Web mining");
  }
  commands.push("/admin - admin panel (faqat admin)");
  const text = commands.join("\n");
  await bot.sendMessage(msg.chat.id, text, MAIN_MENU_KEYBOARD);
});

bot.onText(/\/web/, async (msg) => {
  const webAppUrl = getWebAppUrl();
  if (!webAppUrl) {
    await bot.sendMessage(
      msg.chat.id,
      "Web mining sozlanmagan. Admin bilan bog'laning.",
      MAIN_MENU_KEYBOARD
    );
    return;
  }
  await bot.sendMessage(msg.chat.id, "Web mining:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Open Web Mining", web_app: { url: webAppUrl } }],
      ],
    },
  });
});

bot.onText(/\/admin/, async (msg) => {
  if (!isAdmin(msg.from.id)) {
    await bot.sendMessage(msg.chat.id, "Ruxsat yo'q.");
    return;
  }
  const text = [
    "Admin buyruqlar:",
    "/set <key> <value>",
    "/getsettings",
    "/withdrawals",
    "/approve_withdraw <id>",
    "/deny_withdraw <id>",
    "/uc_requests",
    "/approve_uc <id>",
    "/deny_uc <id>",
    "/addmovie <code|auto> [text] (yoki kanal forwardiga reply)",
    "/delmovie <code>",
    "/drop_run [force]",
    "/broadcast <text>",
    "/stats",
  ].join("\n");
  await bot.sendMessage(msg.chat.id, text);
});

bot.onText(/\/set\s+(\S+)\s+(.+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) {
    await bot.sendMessage(msg.chat.id, "Ruxsat yo'q.");
    return;
  }
  const key = match[1];
  const value = match[2];
  await db.setSetting(key, value);
  await bot.sendMessage(msg.chat.id, `Sozlama saqlandi: ${key} = ${value}`);
});

bot.onText(/\/getsettings/, async (msg) => {
  if (!isAdmin(msg.from.id)) {
    await bot.sendMessage(msg.chat.id, "Ruxsat yo'q.");
    return;
  }
  await handleAdminSettingsList(msg.chat.id);
});

bot.onText(/\/withdrawals/, async (msg) => {
  if (!isAdmin(msg.from.id)) {
    await bot.sendMessage(msg.chat.id, "Ruxsat yo'q.");
    return;
  }
  await handleAdminWithdrawList(msg.chat.id);
});

bot.onText(/\/approve_withdraw\s+(\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) {
    await bot.sendMessage(msg.chat.id, "Ruxsat yo'q.");
    return;
  }
  const id = parseInt(match[1], 10);
  const request = await db.getWithdrawRequestById(id);
  if (!request || request.status !== "pending") {
    await bot.sendMessage(msg.chat.id, "So'rov topilmadi yoki status noto'g'ri.");
    return;
  }
  await db.updateWithdrawStatus(id, "approved");
  await bot.sendMessage(msg.chat.id, `So'rov tasdiqlandi: ${id}`);
  await bot.sendMessage(
    request.user_id,
    `Pul chiqarish so'rovingiz tasdiqlandi. ID: ${id}`
  );
});

bot.onText(/\/deny_withdraw\s+(\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) {
    await bot.sendMessage(msg.chat.id, "Ruxsat yo'q.");
    return;
  }
  const id = parseInt(match[1], 10);
  const request = await db.getWithdrawRequestById(id);
  if (!request || request.status !== "pending") {
    await bot.sendMessage(msg.chat.id, "So'rov topilmadi yoki status noto'g'ri.");
    return;
  }
  await db.updateWithdrawStatus(id, "denied");
  await db.addUserBalance(request.user_id, request.amount);
  await bot.sendMessage(msg.chat.id, `So'rov rad etildi: ${id}`);
  await bot.sendMessage(
    request.user_id,
    `Pul chiqarish so'rovingiz rad etildi. FX qaytarildi. ID: ${id}`
  );
});

bot.onText(/\/uc_requests/, async (msg) => {
  if (!isAdmin(msg.from.id)) {
    await bot.sendMessage(msg.chat.id, "Ruxsat yo'q.");
    return;
  }
  await handleAdminUcList(msg.chat.id);
});

bot.onText(/\/approve_uc\s+(\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) {
    await bot.sendMessage(msg.chat.id, "Ruxsat yo'q.");
    return;
  }
  const id = parseInt(match[1], 10);
  const request = await db.getUcRequestById(id);
  if (!request || request.status !== "pending") {
    await bot.sendMessage(msg.chat.id, "So'rov topilmadi yoki status noto'g'ri.");
    return;
  }
  await db.updateUcStatus(id, "approved");
  await bot.sendMessage(msg.chat.id, `UC so'rovi tasdiqlandi: ${id}`);
  await bot.sendMessage(
    request.user_id,
    `UC so'rovingiz tasdiqlandi. ID: ${id}`
  );
});

bot.onText(/\/deny_uc\s+(\d+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) {
    await bot.sendMessage(msg.chat.id, "Ruxsat yo'q.");
    return;
  }
  const id = parseInt(match[1], 10);
  const request = await db.getUcRequestById(id);
  if (!request || request.status !== "pending") {
    await bot.sendMessage(msg.chat.id, "So'rov topilmadi yoki status noto'g'ri.");
    return;
  }
  await db.updateUcStatus(id, "denied");
  await db.addUserBalance(request.user_id, request.fx_cost);
  await bot.sendMessage(msg.chat.id, `UC so'rovi rad etildi: ${id}`);
  await bot.sendMessage(
    request.user_id,
    `UC so'rovingiz rad etildi. FX qaytarildi. ID: ${id}`
  );
});

bot.onText(/\/addmovie(?:\s+(\S+))?(?:\s+([\s\S]+))?/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) {
    await bot.sendMessage(msg.chat.id, "Ruxsat yo'q.");
    return;
  }
  const rawCode = match && match[1] ? match[1].trim() : "";
  const codeArg = rawCode.toLowerCase();
  let code = rawCode && !["auto", "next"].includes(codeArg) ? rawCode : "";
  let content = null;

  if (msg.reply_to_message) {
    content = extractMovieContentFromReply(msg.reply_to_message);
  }

  if (!content && match[2]) {
    content = { type: "text", value: match[2].trim() };
  }

  if (!content) {
    await bot.sendMessage(
      msg.chat.id,
      "Foydalanish: /addmovie CODE <text> yoki kanal xabariga reply (/addmovie auto).",
      MAIN_MENU_KEYBOARD
    );
    return;
  }

  if (!code) {
    code = await db.getNextMovieCode();
  }

  await db.addMovieCode({
    code,
    content_type: content.type,
    content_value: content.value,
    channel_id: content.channel_id,
    channel_message_id: content.channel_message_id,
    added_by: msg.from.id,
  });
  await bot.sendMessage(msg.chat.id, `Kino kodi saqlandi: ${code}`);
});

bot.onText(/\/delmovie\s+(\S+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) {
    await bot.sendMessage(msg.chat.id, "Ruxsat yo'q.");
    return;
  }
  await db.deleteMovieCode(match[1]);
  await bot.sendMessage(msg.chat.id, `Kino kodi o'chirildi: ${match[1]}`);
});

bot.onText(/\/drop_run(?:\s+(\S+))?/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) {
    await bot.sendMessage(msg.chat.id, "Ruxsat yo'q.");
    return;
  }
  const force = match[1] && match[1].toLowerCase() === "force";
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const existing = await db.getDropRecord(month, year);
  if (existing && !force) {
    await bot.sendMessage(
      msg.chat.id,
      "Bu oy uchun drop allaqachon berilgan. /drop_run force ishlating."
    );
    return;
  }

  const topUsers = await db.getTopUsers(10);
  if (!topUsers.length) {
    await bot.sendMessage(msg.chat.id, "Top foydalanuvchi yo'q.");
    return;
  }

  const bonusFx = (await db.getSettingNumber("drop_bonus_fx")) || 0;
  const premiumDays = (await db.getSettingNumber("drop_premium_days")) || 0;
  const nowTs = Date.now();

  for (const user of topUsers) {
    await db.addUserBalance(user.id, bonusFx);
    if (premiumDays > 0) {
      const base =
        user.premium_until && user.premium_until > nowTs
          ? user.premium_until
          : nowTs;
      const newUntil = base + premiumDays * 24 * 60 * 60 * 1000;
      await db.setUserPremiumUntil(user.id, newUntil);
    }
    await bot.sendMessage(
      user.id,
      `Tabriklaymiz! Siz TOP 10ga kirdingiz. Bonus: ${bonusFx} FX`
    );
  }

  await db.addDropRecord({
    month,
    year,
    notes: `drop_bonus_fx=${bonusFx}, drop_premium_days=${premiumDays}`,
  });
  await bot.sendMessage(msg.chat.id, "Drop yakunlandi.");
});

bot.onText(/\/broadcast\s+([\s\S]+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) {
    await bot.sendMessage(msg.chat.id, "Ruxsat yo'q.");
    return;
  }
  const text = match[1];
  const users = await db.getAllUserIds();
  let sent = 0;
  for (const row of users) {
    try {
      await bot.sendMessage(row.id, text);
      sent += 1;
    } catch (err) {
      // ignore failed sends
    }
  }
  await bot.sendMessage(msg.chat.id, `Yuborildi: ${sent} ta foydalanuvchi.`);
});

bot.onText(/\/stats/, async (msg) => {
  if (!isAdmin(msg.from.id)) {
    await bot.sendMessage(msg.chat.id, "Ruxsat yo'q.");
    return;
  }
  const stats = await db.getStats();
  const pendingWithdraw = await db.getPendingWithdrawRequests();
  const pendingUc = await db.getPendingUcRequests();
  const text = [
    `Foydalanuvchilar: ${stats.user_count}`,
    `Jami FX: ${formatNumber(stats.total_fx)}`,
    `Pending withdraw: ${pendingWithdraw.length}`,
    `Pending UC: ${pendingUc.length}`,
  ].join("\n");
  await bot.sendMessage(msg.chat.id, text);
});

bot.on("message", async (msg) => {
  if (!msg.text) {
    return;
  }
  if (msg.text.startsWith("/")) {
    return;
  }

  const { user } = await ensureUser(msg.from);
  const handledState = await handleStateMessage(msg, user);
  if (handledState) {
    return;
  }

  const text = msg.text.trim();
  const chatId = msg.chat.id;

  switch (text) {
    case "Mining":
      await handleMining(chatId, user);
      break;
    case "Profil":
      await sendProfile(chatId, user);
      break;
    case "Referral":
      await handleReferralInfo(chatId, user);
      break;
    case "Premium":
      await handlePremiumInfo(chatId, user);
      break;
    case "Premium sotib olish":
      await handlePremiumPurchase(chatId, user);
      break;
    case "Kino kodi":
      await startMovieFlow(chatId, user);
      break;
    case "Reyting":
      await handleTopUsers(chatId);
      break;
    case "Pul kiritish/chiqarish":
      await handlePayoutInfo(chatId);
      break;
    case "Pul chiqarish":
      await startWithdrawFlow(chatId, user);
      break;
    case "UC xarid":
      await startUcFlow(chatId, user);
      break;
    case "Balans to'ldirish":
      await bot.sendMessage(
        chatId,
        config.ADMIN_CONTACT
          ? `Balans to'ldirish uchun: ${config.ADMIN_CONTACT}`
          : "Balans to'ldirish uchun admin bilan bog'laning.",
        MAIN_MENU_KEYBOARD
      );
      break;
    case "Menu":
      await sendMainMenu(chatId);
      break;
    default:
      await sendMainMenu(chatId);
  }
});

if (!USE_WEBHOOK) {
  bot.on("polling_error", (err) => {
    console.error("Polling error:", err.message);
  });
} else {
  bot.on("webhook_error", (err) => {
    console.error("Webhook error:", err.message);
  });
}

async function bootstrap() {
  await db.initDb();
  startWebServer();
  try {
    const me = await bot.getMe();
    if (!botUsername) {
      botUsername = me.username;
    }
  } catch (err) {
    // ignore
  }
  const commands = [
    { command: "start", description: "Botni ishga tushirish" },
    { command: "help", description: "Yordam" },
  ];
  if (config.WEBAPP_URL) {
    commands.push({ command: "web", description: "Web mining" });
  }
  if (config.ADMIN_IDS.length > 0) {
    commands.push({ command: "admin", description: "Admin panel" });
  }
  await bot.setMyCommands(commands);
  if (USE_WEBHOOK) {
    await bot.setWebHook(WEBHOOK_URL);
  } else {
    await bot.deleteWebHook({ drop_pending_updates: false });
    bot.startPolling();
  }
  console.log("FX-VM bot ishga tushdi.");
}

bootstrap().catch((err) => {
  console.error("Startup error:", err);
  process.exit(1);
});
