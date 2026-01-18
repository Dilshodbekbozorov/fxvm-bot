# FX Movie Code Bot

Private Telegram channel movie index. The bot reads new channel posts, extracts code from caption, saves it to DB, and lets users request a movie by sending the code.

## Setup

1) `npm install`
2) Create `.env` (or copy `.env.example`) and fill:
   - `BOT_TOKEN`
   - `DATABASE_URL`
   - `ADMIN_IDS` (comma separated)
   - `CHANNEL_ID` (channel numeric id, example: `-1001234567890`)
   - `PG_SSL` (optional: true/false)
3) `npm start`

## How to add the bot to the channel

1) Open the private channel settings.
2) Add the bot as an admin.
3) Make sure the bot can read messages (admin is enough).
4) Post new movies with caption like `KOD: 184` or `KODI: 184`.

## How to find CHANNEL_ID

- Forward any channel post to @userinfobot or @getmyid_bot. The bot will show the channel id.
- It looks like `-1001234567890`.

## How it works

- When a new channel post arrives, the bot parses the caption with a regex.
- Code is unique. If the same code appears again, it updates the record.
- Users can send `184` or `KOD: 184` to the bot and receive the post via `copyMessage`.

## Admin commands

- `/stats` -> how many movies are indexed
- `/del 184` -> delete a code
- `/set 184 <messageId>` -> manual bind for older posts in the channel

## Testing

1) Post a new movie in the channel with caption `KOD: 184`.
2) Send `184` to the bot in private chat.
3) The bot should copy the post from the channel to the user.

## Structure

- `src/index.js` start
- `src/bot.js` handlers
- `src/db.js` database
- `src/models/Movie.js` movie model
- `src/utils/parseCode.js` regex parser
- `src/utils/isAdmin.js` admin check
