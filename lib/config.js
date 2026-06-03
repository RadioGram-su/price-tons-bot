const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONFIG_DIR = process.env.BOT_CONFIG_DIR || process.env.CONFIG_DIR || path.join(ROOT, "config");
const TOKENS = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, "tokens.json"), "utf8"));

function botMention() {
  const name = String(process.env.BOT_USERNAME || "Price_Tons_bot").replace(/^@+/, "");
  return `@${name}`;
}

module.exports = {
  ROOT,
  CONFIG_DIR,
  TOKENS,
  BOT_USERNAME: process.env.BOT_USERNAME || "Price_Tons_bot",
  botMention,
  GRAM_DNS_URL: "https://t.me/dnsdotgram",
  ALERT_LIMIT: Number(process.env.ALERT_LIMIT || 5),
  WATCH_LIMIT: Number(process.env.WATCH_LIMIT || 5),
  WATCH_BONUS_PER_REFERRAL: Number(process.env.WATCH_BONUS_PER_REFERRAL || 2),
  CHECK_INTERVAL_MS: Number(process.env.CHECK_INTERVAL_MS || 60_000),
  DEFAULT_TIMEZONE_OFFSET: Number(process.env.DEFAULT_TIMEZONE_OFFSET || 3),
  DIGEST_MORNING_HOUR: Number(process.env.DIGEST_MORNING_HOUR || 9),
  DIGEST_EVENING_HOUR: Number(process.env.DIGEST_EVENING_HOUR || 20),
  BIG_MOVE_PCT: Number(process.env.BIG_MOVE_PCT || 20),
  PUMP_WARN_PCT: Number(process.env.PUMP_WARN_PCT || 100),
  PUMP_SCAM_PCT: Number(process.env.PUMP_SCAM_PCT || 200),
  SPREAD_WARN_PCT: Number(process.env.SPREAD_WARN_PCT || 5),
  DIGEST_MIN_DAY_CHANGE_PCT: Number(process.env.DIGEST_MIN_DAY_CHANGE_PCT || 0.5),
  QUIET_HOURS_START: Number(process.env.QUIET_HOURS_START || 23),
  QUIET_HOURS_END: Number(process.env.QUIET_HOURS_END || 8),
  REFERRAL_ALERT_BONUS: Number(process.env.REFERRAL_ALERT_BONUS || 1),
  WHALE_VOL_JUMP_PCT: Number(process.env.WHALE_VOL_JUMP_PCT || 80),
  VOLUME_SPIKE_PCT: Number(process.env.VOLUME_SPIKE_PCT || 200),
  WHALE_MIN_TON: Number(process.env.WHALE_MIN_TON || 500),
  CHANNEL_ID: process.env.CHANNEL_ID || "",
  CHANNEL_POST_PCT: Number(process.env.CHANNEL_POST_PCT || 10),
  ADMIN_CHAT_ID: process.env.ADMIN_CHAT_ID || "2010814946",
  RADIO_GRAM_URL: process.env.RADIO_GRAM_URL || "https://player.radiogram.su/",
  CHANNEL_URL: process.env.CHANNEL_URL || "https://t.me/gramradiochill",
  SUPPORT_URL: process.env.SUPPORT_URL || "https://pay.cloudtips.ru/p/b5dba7c2",
  TON_WALLET: process.env.TON_WALLET || "UQDNJZb6MPyqP1P1JONmZ5Que0_UMA1n4k3ugAYcVEv7XH3Q",
  USE_WEBHOOK: process.env.USE_WEBHOOK === "1" || process.env.USE_WEBHOOK === "true",
  WEBHOOK_PATH: process.env.WEBHOOK_PATH || "/telegram-webhook",
  BACKUP_EVERY_MS: Number(process.env.BACKUP_EVERY_MS || 3600_000),
  COINGECKO_API: "https://api.coingecko.com/api/v3",
  TONCO_GRAPHQL: "https://indexer.tonco.io/graphql"
};
