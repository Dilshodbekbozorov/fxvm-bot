# FX-VM Telegram Bot

Node.js va node-telegram-bot-api asosida Telegram bot. FX token mining, referral, premium, UC so'rovlar va kodli kino funksiyalarini taqdim etadi. Ma'lumotlar bazasi PostgreSQL.

## Tez start

1. `npm install`
2. `.env.example` faylini `.env` qilib ko'chiring va sozlang.
3. `npm start`

## Muhim sozlamalar

- `BOT_TOKEN` - Telegram bot tokeni
- `ADMIN_IDS` - admin Telegram ID'lar, vergul bilan ajratilgan
- `BOT_USERNAME` - bot username (majburiy emas, referral link uchun qulay)
- `ADMIN_CONTACT` - balans to'ldirish uchun kontakt
- `DATABASE_URL` - PostgreSQL connection string
- `PG_SSL` - `true` bo'lsa SSL yoqiladi (Render tashqi ulanishlar uchun tavsiya)
- `WEBAPP_URL` - Web mining uchun to'liq URL (masalan: Render servis URL). Render web servisida `RENDER_EXTERNAL_URL` avtomatik ishlatiladi.

## Asosiy funksiyalar

- Mining: cooldown va premium rate orqali FX yig'ish
- Referral: har bir foydalanuvchi uchun referral kod va bonus
- Premium: FX balans evaziga premium sotib olish
- Kino kodi: kod orqali kontent yuborish (admin orqali qo'shiladi)
- Reyting: TOP 10 real vaqt
- Pul chiqarish: oyning belgilangan kuni so'rov qoldirish
- PUBG UC: UC so'rovi va admin tasdiqlashi

## Admin buyruqlari

- `/admin` - yordam
- `/set <key> <value>` - sozlamani o'zgartirish
- `/getsettings` - sozlamalar ro'yxati
- `/withdrawals` - pending pul chiqarishlar
- `/approve_withdraw <id>` - tasdiqlash
- `/deny_withdraw <id>` - rad etish (FX qaytariladi)
- `/uc_requests` - pending UC so'rovlari
- `/approve_uc <id>` - tasdiqlash
- `/deny_uc <id>` - rad etish (FX qaytariladi)
- `/addmovie <code|auto> <text>` - kino kodi qo'shish (kanaldan forward qilingan xabarga reply ham bo'ladi)
- `/delmovie <code>` - o'chirish
- `/drop_run [force]` - TOP 10 uchun drop berish
- `/broadcast <text>` - barcha foydalanuvchilarga xabar
- `/stats` - statistikalar

Kanal kodi bog'lash:
Kanal xabarini botga forward qiling, so'ng o'sha xabarga reply qilib `/addmovie CODE` yoki `/addmovie auto` yuboring.
`auto` bo'lsa kod ketma-ket raqam bilan avtomatik beriladi (1,2,3...).
Ketma-ketlik to'g'ri bo'lishi uchun kinolarni kanal tartibida qo'shib boring.

## Sozlama kalitlari (settings)

Default kalitlar `config.js` ichida:

- `referral_bonus`
- `mine_amount`
- `premium_mine_amount`
- `mine_cooldown_seconds`
- `payout_day`
- `premium_cost`
- `premium_days`
- `drop_bonus_fx`
- `drop_premium_days`
- `uc_fx_rate`

## Eslatma

- Referral bonusi faqat yangi foydalanuvchi /start bosganda beriladi.
- Bitta foydalanuvchi uchun 1 marta referral bonus ishlaydi.
- Anti-multiaccount bo'yicha minimal himoya mavjud (Telegram ID asosida).
- Kino kodi kanal xabariga ulangan bo'lsa, bot kanalda admin bo'lishi va xabarlarni ko'rishga ruxsatga ega bo'lishi kerak.
- Kanalda "Protect content" yoqilgan bo'lsa forward ishlamaydi.

## Web mining

- Web sahifa `/` da servis qilinadi.
- Bot menyusida "Web Mining" tugmasi chiqishi uchun `WEBAPP_URL` ni sozlang.
- Telegram Web App auth tekshiruvi bor, shuning uchun web sahifani faqat bot ichidan ochish tavsiya qilinadi.
- BotFather orqali Web App domainini `WEBAPP_URL` domeniga ruxsat bering.

## Render deploy

1. Render'da PostgreSQL database yarating.
2. Web Service (Node) yarating.
3. Environment variables:
   - `BOT_TOKEN`
   - `ADMIN_IDS`
   - `BOT_USERNAME` (ixtiyoriy)
   - `ADMIN_CONTACT` (ixtiyoriy)
   - `DATABASE_URL` (Render DB connection string)
   - `PG_SSL=true`
   - `WEBAPP_URL` (Render servis URL)
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Ixtiyoriy: `render.yaml` faylidan blueprint sifatida foydalaning.
# fxvm-bot
