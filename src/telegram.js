import TelegramBot from 'node-telegram-bot-api';

let bot = null;

function getBot() {
  if (bot) return bot;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  bot = new TelegramBot(token, { polling: false });
  return bot;
}

export async function sendAlert({ movie, theater, site, url, showtimes = [], body }) {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const b = getBot();
  if (!b || !chatId) {
    console.warn('[telegram] Skipping alert — TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set.');
    return false;
  }
  const text = body || `${movie} [${theater}] - Booking Opened`;
  try {
    await b.sendMessage(chatId, text, { disable_web_page_preview: true });
    return true;
  } catch (err) {
    console.error('[telegram] sendAlert failed:', err.message);
    return false;
  }
}

export async function sendTestMessage() {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const b = getBot();
  if (!b || !chatId) return false;
  await b.sendMessage(chatId, '✅ 70 mm Filmax is connected and watching.');
  return true;
}
