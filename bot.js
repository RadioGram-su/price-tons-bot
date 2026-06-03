const fs = require("fs");
const path = require("path");
const http = require("http");

const CFG = require("./lib/config");
const { resolveAsset, resolveMany, isTonAddress, presetsKeyboard } = require("./lib/assets");
const {
  getJettonPrices,
  pickPriceUsd,
  formatPricesMessage,
  priceKeyboard,
  formatPriceUsd
} = require("./lib/prices");
const { recordPrice, getMarketStats, formatChangePct, dayKey } = require("./lib/history");
const { sparklineFromSamples } = require("./lib/sparkline");
const { t } = require("./lib/i18n");
const {
  evaluateAlert,
  detectAutoPump,
  recordWhaleSignals,
  digestHasMovement,
  kindLabel,
  formatDigestTokenBlock,
  getTopMovers,
  scanNewPools
} = require("./lib/engine");
const { escapeMd } = require("./lib/markdown");
const { isQuietHours } = require("./lib/quiet-hours");
const { backupState } = require("./lib/backup");
const { recordApiFailure, recordApiSuccess, shouldNotifyAdmin, adminAlertMessage } = require("./lib/monitor");
const { invalidate } = require("./lib/price-queue");
const ADMIN = require("./lib/admin-stats");
const { alertImageBuffer } = require("./lib/alert-art");
const { guidesMenuKeyboard, getGuide, formatGuide, listGuides } = require("./lib/knowledge");
const { getStonAssetByAddress } = require("./lib/assets");
const { mdLink, stonAssetUrl, gramDnsUrl, isGrm } = require("./lib/links");
const { botMention } = CFG;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = Number(process.env.PORT || 8789);
const SELF_TEST = process.argv.includes("--self-test");
const ROOT_DIR = __dirname;
const DATA_DIR = process.env.BOT_DATA_DIR || process.env.DATA_DIR || path.join(ROOT_DIR, "data");
const STATE_PATH = process.env.BOT_STATE_PATH || path.join(DATA_DIR, "state.json");

const state = loadState();
state.bootAt = state.bootAt || Date.now();

const DEPLOY_FILES = [
  "lib/config.js",
  "lib/assets.js",
  "lib/prices.js",
  "lib/history.js",
  "lib/sparkline.js",
  "lib/i18n.js",
  "lib/engine.js",
  "lib/backup.js",
  "lib/monitor.js",
  "lib/price-queue.js",
  "lib/pools.js",
  "lib/tonco.js",
  "lib/coingecko.js",
  "lib/knowledge.js",
  "lib/tones.js",
  "lib/links.js",
  "lib/risk.js",
  "lib/alert-art.js",
  "lib/markdown.js",
  "lib/quiet-hours.js",
  "lib/admin-stats.js",
  "config/tokens.json"
];

function assertDeployFiles() {
  const missing = DEPLOY_FILES.filter((rel) => !fs.existsSync(path.join(ROOT_DIR, rel)));
  if (missing.length) {
    console.error("❌ Не хватает файлов для деплоя. Залей на сервер:\n");
    for (const f of missing) console.error("   ", f);
    console.error("\nПапка lib/ и config/ должны быть рядом с bot.js, не в volume /app/data");
    process.exit(1);
  }
}

assertDeployFiles();

if (!BOT_TOKEN && !SELF_TEST) {
  console.error("Missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

const telegramApi = `https://api.telegram.org/bot${BOT_TOKEN}`;

(SELF_TEST ? runSelfTest() : main()).catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  if (CFG.USE_WEBHOOK && CFG.PUBLIC_BASE_URL) {
    await startWebhookServer();
    console.log(`${botMention()} webhook mode`);
  } else {
    startHealthServer();
    startLoops();
    console.log(`${botMention()} polling mode`);
    let offset = Number(process.env.TELEGRAM_POLLING_OFFSET || 0);
    while (true) {
      try {
        const updates = await telegram("getUpdates", {
          offset,
          timeout: 30,
          allowed_updates: ["message", "callback_query", "inline_query"]
        });
        for (const update of updates.result || []) {
          offset = update.update_id + 1;
          await handleUpdate(update);
        }
      } catch (error) {
        console.error("Polling:", error.message);
        await wait(1500);
      }
    }
  }
}

async function handleUpdate(update) {
  if (update.inline_query) {
    await handleInlineQuery(update.inline_query);
    return;
  }
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }
  const message = update.message;
  if (!message?.text) return;

  const chatId = message.chat.id;
  const userId = String(message.from.id);
  touchUser(userId);

  const text = message.text.trim();
  const lower = text.toLowerCase();
  const lang = getLang(userId);

  if (lower.startsWith("/start")) {
    const ref = text.match(/ref_([A-Za-z0-9_-]+)/)?.[1];
    if (ref) applyReferral(userId, ref);
    if (!state.users[userId].onboarded) {
      await sendMessage(chatId, welcomeText(userId), onboardingKeyboard());
      return;
    }
    const since = sinceLastVisitBlock(userId);
    snapshotVisitPrices(userId);
    saveState();
    await sendMessage(chatId, welcomeText(userId) + (since ? `\n\n${since}` : ""), mainKeyboard());
    return;
  }

  if (lower.startsWith("/help")) {
    await sendMessage(chatId, helpText(userId), mainKeyboard());
    return;
  }

  if (lower.startsWith("/settings")) {
    await sendMessage(chatId, settingsText(userId), settingsKeyboard());
    return;
  }

  if (lower.startsWith("/grm")) {
    await sendPriceCard(chatId, userId, CFG.TOKENS.grm.address);
    return;
  }

  if (lower.startsWith("/top")) {
    await sendTop(chatId, userId);
    return;
  }

  if (lower.startsWith("/new")) {
    await sendNewTokens(chatId, userId);
    return;
  }

  if (lower.startsWith("/price")) {
    const query = text.replace(/^\/price(@\w+)?/i, "").trim();
    if (!query) {
      await sendMessage(chatId, pickText(userId, "price_prompt"), presetsKeyboard("price"));
      return;
    }
    await sendPrice(chatId, userId, query);
    return;
  }

  if (lower.startsWith("/list") || lower.startsWith("/alerts")) {
    await sendMessage(chatId, alertsText(userId), alertsKeyboard(userId));
    return;
  }

  if (lower.startsWith("/add")) {
    beginAddAlert(userId);
    await sendMessage(chatId, pickText(userId, "add_alert"));
    return;
  }

  if (lower.startsWith("/alertbatch")) {
    await createBatchWatchlistAlerts(userId, chatId);
    return;
  }

  if (lower.startsWith("/delete") || lower.startsWith("/remove")) {
    if (!getAlerts(userId).length) {
      await sendMessage(chatId, pickText(userId, "no_alerts"), mainKeyboard());
      return;
    }
    await sendMessage(chatId, pickText(userId, "pick_delete"), alertsKeyboard(userId));
    return;
  }

  if (lower.startsWith("/watchlist") || lower.startsWith("/digest")) {
    await sendMessage(chatId, watchlistText(userId), watchlistKeyboard(userId));
    return;
  }

  if (lower.startsWith("/watch")) {
    const arg = text.replace(/^\/watch(@\w+)?/i, "").trim();
    if (arg.includes(",")) {
      await importWatchlist(userId, chatId, arg);
      return;
    }
    if (arg) {
      await addWatchByQuery(userId, chatId, arg);
      return;
    }
    beginAddWatch(userId);
    await sendMessage(chatId, pickText(userId, "add_watch"));
    return;
  }

  if (lower.startsWith("/unwatch")) {
    if (!getWatchlist(userId).length) {
      await sendMessage(chatId, pickText(userId, "no_watch"), mainKeyboard());
      return;
    }
    await sendMessage(chatId, pickText(userId, "pick_unwatch"), watchlistKeyboard(userId));
    return;
  }

  if (lower.startsWith("/ref")) {
    await sendMessage(chatId, referralText(userId), mainKeyboard());
    return;
  }

  if (lower.startsWith("/support") || lower.startsWith("/donate")) {
    await sendSupport(chatId);
    return;
  }

  if (lower.startsWith("/compare")) {
    const args = text.replace(/^\/compare(@\w+)?/i, "").trim().split(/[\s,]+/).filter(Boolean);
    if (args.length < 2) {
      await sendMessage(chatId, "Использование: `/compare NOT DOGS` или `/compare GRM, NOT`");
      return;
    }
    await sendCompare(chatId, userId, args[0], args[1]);
    return;
  }

  if (lower.startsWith("/spread")) {
    const query = text.replace(/^\/spread(@\w+)?/i, "").trim();
    if (!query) {
      await sendMessage(chatId, "Спред DEX: `/spread NOT` — или создай алерт через `/add` → «Спред DEX»");
      return;
    }
    await sendSpreadInfo(chatId, userId, query);
    return;
  }

  if (lower.startsWith("/exportwatchlist") || lower.startsWith("/export")) {
    await sendExportWatchlist(chatId, userId);
    return;
  }

  if (lower.startsWith("/guide") || lower.startsWith("/kb")) {
    await sendMessage(chatId, "📚 **База знаний Price Tons**\n\nКороткие гайды — как не слить на мемах:", guidesMenuKeyboard());
    return;
  }

  if (lower.startsWith("/adminstats")) {
    if (!ADMIN.isAdmin(userId, CFG.ADMIN_CHAT_ID)) return;
    await sendMessage(chatId, adminStatsText());
    return;
  }

  if (lower.startsWith("/cancel")) {
    state.users[userId].awaitingInput = null;
    saveState();
    await sendMessage(chatId, pickText(userId, "cancelled"), mainKeyboard());
    return;
  }

  const quickTicker = (CFG.TOKENS.presets || []).find((p) => p.symbol.toUpperCase() === text.toUpperCase());
  if (quickTicker) {
    await sendPrice(chatId, userId, quickTicker.symbol);
    return;
  }

  if (text === "💎 Цена") {
    await sendMessage(chatId, pickText(userId, "price_prompt"), presetsKeyboard("price"));
    return;
  }
  if (text === "➕ Алерт") {
    beginAddAlert(userId);
    await sendMessage(chatId, pickText(userId, "add_alert"));
    return;
  }
  if (text === "📋 Мои алерты" || text === "📋 Алерты") {
    await sendMessage(chatId, alertsText(userId), alertsKeyboard(userId));
    return;
  }
  if (text === "📬 Дайджест") {
    await sendMessage(chatId, watchlistText(userId), watchlistKeyboard(userId));
    return;
  }
  if (text === "⚙️ Настройки") {
    await sendMessage(chatId, settingsText(userId), settingsKeyboard());
    return;
  }
  if (text === "📊 Топ") {
    await sendTop(chatId, userId);
    return;
  }
  if (text === "❓ Помощь") {
    await sendMessage(chatId, helpText(userId), mainKeyboard());
    return;
  }
  if (text === "☕ Поддержать") {
    await sendSupport(chatId);
    return;
  }

  await handleAwaitingInput(userId, chatId, text);
}

async function handleInlineQuery(inlineQuery) {
  const query = (inlineQuery.query || "").trim();
  const queryId = inlineQuery.id;
  const userId = String(inlineQuery.from?.id || "");
  if (userId) touchUser(userId);

  try {
    if (!query) {
      await answerInline(queryId, (CFG.TOKENS.presets || []).slice(0, 6).map((p) => ({
        type: "article",
        id: `hint-${p.symbol}`,
        title: `${p.symbol} — ${p.name}`,
        description: "Нажми, чтобы отправить цену в чат",
        input_message_content: {
          message_text: `💎 ${p.symbol}\n\nВведи: ${botMention()} ${p.symbol}`
        }
      })));
      return;
    }

    const resolved = await resolveAsset(query);
    if (!resolved) {
      await answerInline(queryId, [{
        type: "article",
        id: "not-found",
        title: "Не найдено",
        description: `Попробуй NOT, GRM, DOGS или адрес EQ...`,
        input_message_content: {
          message_text: `❌ Jetton «${query}» не найден.\n\n${botMention()}`
        }
      }]);
      return;
    }

    if (resolved.multiple?.length) {
      const results = [];
      for (const asset of resolved.multiple.slice(0, 5)) {
        const prices = await getJettonPrices(asset.address);
        results.push(inlineResultFromPrices(asset, prices));
      }
      await answerInline(queryId, results);
      return;
    }

    const prices = await getJettonPrices(resolved.address);
    await answerInline(queryId, [inlineResultFromPrices(resolved, prices)]);
  } catch (error) {
    console.error("Inline query error:", error.message);
    await answerInline(queryId, [{
      type: "article",
      id: "error",
      title: "Ошибка загрузки",
      description: error.message.slice(0, 60),
      input_message_content: {
        message_text: `⚠️ Не удалось получить цену.\n\n${botMention()}`
      }
    }]).catch(() => {});
  }
}

function inlineResultFromPrices(asset, prices) {
  const avg = pickPriceUsd(prices, "avg");
  const text = inlinePriceText(prices);
  return {
    type: "article",
    id: asset.address,
    title: `${asset.symbol} · ${formatPriceUsd(avg)}`,
    description: asset.name,
    input_message_content: {
      message_text: `${text}\n\n${botMention()}`
    }
  };
}

function inlinePriceText(prices) {
  const lines = [
    `💎 ${prices.symbol} · ${prices.name}`,
    "",
    prices.ston?.priceUsd ? `STON.fi: ${formatPriceUsd(prices.ston.priceUsd)}` : null,
    prices.dedust?.priceUsd ? `DeDust: ${formatPriceUsd(prices.dedust.priceUsd)}` : null,
    prices.tonco?.priceUsd ? `Tonco: ${formatPriceUsd(prices.tonco.priceUsd)}` : null,
    prices.avgUsd ? `Средняя: ${formatPriceUsd(prices.avgUsd)}` : null,
    prices.bestBuy ? `Дешевле: ${prices.bestBuy.dex}` : null
  ].filter(Boolean);
  return lines.join("\n");
}

async function answerInline(inlineQueryId, results) {
  await telegram("answerInlineQuery", {
    inline_query_id: inlineQueryId,
    results,
    cache_time: 30,
    is_personal: false
  });
}

async function handleCallback(callback) {
  const data = callback.data || "";
  const chatId = callback.message?.chat?.id;
  const userId = String(callback.from.id);
  touchUser(userId);
  await telegram("answerCallbackQuery", { callback_query_id: callback.id }).catch(() => {});
  if (!chatId) return;

  if (data === "menu:add") {
    beginAddAlert(userId);
    await sendMessage(chatId, pickText(userId, "add_alert"));
    return;
  }
  if (data === "menu:list") {
    await sendMessage(chatId, alertsText(userId), alertsKeyboard(userId));
    return;
  }
  if (data === "menu:help") {
    await sendMessage(chatId, helpText(userId), mainKeyboard());
    return;
  }
  if (data === "menu:watch") {
    beginAddWatch(userId);
    await sendMessage(chatId, pickText(userId, "add_watch"));
    return;
  }
  if (data === "menu:export") {
    await sendExportWatchlist(chatId, userId);
    return;
  }
  if (data === "menu:settings") {
    await sendMessage(chatId, settingsText(userId), settingsKeyboard());
    return;
  }
  if (data === "menu:support") {
    await sendSupport(chatId);
    return;
  }

  if (data === "guide:menu") {
    await sendMessage(chatId, "📚 **База знаний**", guidesMenuKeyboard());
    return;
  }

  if (data.startsWith("guide:") && data !== "guide:menu") {
    const guide = getGuide(data.slice(6));
    if (guide) await sendMessage(chatId, formatGuide(guide), guidesMenuKeyboard());
    return;
  }

  if (data.startsWith("onboard:")) {
    const action = data.slice(8);
    state.users[userId].onboarded = true;
    saveState();
    if (action === "not") await addWatchByQuery(userId, chatId, "NOT", true);
    else if (action === "grm") await addWatchByQuery(userId, chatId, "GRM", true);
    else if (action === "both") {
      await importWatchlist(userId, chatId, "NOT, GRM", true);
    } else {
      await sendMessage(chatId, welcomeText(userId), mainKeyboard());
    }
    return;
  }

  if (data.startsWith("price:")) {
    await sendPriceCard(chatId, userId, data.slice(6));
    return;
  }

  if (data.startsWith("refresh:")) {
    invalidate(data.slice(8));
    await sendPriceCard(chatId, userId, data.slice(8));
    return;
  }

  if (data.startsWith("quickalert:")) {
    const address = data.slice(11);
    const prices = await getJettonPrices(address);
    state.users[userId].awaitingInput = {
      type: "alert_kind",
      address,
      symbol: prices.symbol,
      name: prices.name,
      basePriceUsd: pickPriceUsd(prices, "avg")
    };
    saveState();
    await sendMessage(chatId, `${formatPricesMessage(prices, { lang: getLang(userId) })}\n\n**Тип алерта:**`, kindKeyboard());
    return;
  }

  if (data.startsWith("quickwatch:")) {
    await finalizeWatch(userId, chatId, data.slice(11));
    return;
  }

  if (data.startsWith("pick:")) {
    const address = data.slice(5);
    const pending = state.users[userId].awaitingInput;
    if (pending?.type === "watch_token") await finalizeWatch(userId, chatId, address);
    else if (pending?.type === "alert_token" || pending?.type === "alert_kind") await continueWithAsset(userId, chatId, address);
    else await sendPriceCard(chatId, userId, address);
    return;
  }

  if (data.startsWith("template:")) {
    const parts = data.split(":");
    const kind = parts[1];
    const presetThreshold = parts[2] ? Number(parts[2]) : null;
    const pending = state.users[userId].awaitingInput;
    if (!pending?.address) return;
    pending.type = "alert_kind";
    pending.kind = kind;
    if (kind === "pump") {
      pending.threshold = CFG.PUMP_WARN_PCT;
      pending.source = "avg";
      pending.type = "alert_repeat";
      saveState();
      await sendMessage(
        chatId,
        `🕵️ **Памп ${pending.symbol}** ≥ **${CFG.PUMP_WARN_PCT}%**/ч\n\n**Повтор:**`,
        repeatKeyboard()
      );
      return;
    }
    if (kind === "spread_dex") {
      pending.threshold = presetThreshold || CFG.SPREAD_WARN_PCT;
      pending.source = "avg";
      pending.type = "alert_repeat";
      saveState();
      await sendMessage(chatId, `⚠️ Спред DEX ≥ **${pending.threshold}%**\n\n**Повтор:**`, repeatKeyboard());
      return;
    }
    if (kind === "new_pool") {
      pending.threshold = 0;
      pending.source = "avg";
      pending.type = "alert_repeat";
      saveState();
      await sendMessage(chatId, "**Повтор алерта:**", repeatKeyboard());
      return;
    }
    if (presetThreshold && Number.isFinite(presetThreshold)) {
      pending.threshold = presetThreshold;
      pending.type = "alert_source";
      saveState();
      await sendMessage(chatId, `⚡ **±${presetThreshold}%**\n\nИсточник:`, sourceKeyboard());
      return;
    }
    pending.type = "alert_threshold";
    saveState();
    await sendMessage(chatId, thresholdPrompt(kind));
    return;
  }

  if (data.startsWith("kind:")) {
    const parts = data.split(":");
    const kind = parts[1];
    const presetThreshold = parts[2] ? Number(parts[2]) : null;
    const pending = state.users[userId].awaitingInput;
    if (!pending || pending.type !== "alert_kind") return;
    pending.kind = kind;
    if (kind === "spread_dex") {
      pending.threshold = CFG.SPREAD_WARN_PCT;
      pending.source = "avg";
      pending.type = "alert_repeat";
      saveState();
      await sendMessage(chatId, `⚠️ Спред DEX ≥ **${CFG.SPREAD_WARN_PCT}%**\n\n**Повтор:**`, repeatKeyboard());
      return;
    }
    if (["volume_spike", "liquidity_below", "whale"].includes(kind)) {
      pending.type = "alert_threshold";
      saveState();
      await sendMessage(chatId, thresholdPrompt(kind));
      return;
    }
    if (kind === "new_pool") {
      pending.threshold = 0;
      pending.source = "avg";
      pending.type = "alert_repeat";
      saveState();
      await sendMessage(chatId, "**Повтор алерта:**", repeatKeyboard());
      return;
    }
    if (kind === "pump") {
      pending.threshold = CFG.PUMP_WARN_PCT;
      pending.source = "avg";
      pending.type = "alert_repeat";
      saveState();
      await sendMessage(
        chatId,
        `🕵️ **Алерт на памп** ≥ **${CFG.PUMP_WARN_PCT}%** за ~час\n\n≥ **${CFG.PUMP_SCAM_PCT}%** — предупреждение о скаме\n\n**Повтор:**`,
        repeatKeyboard()
      );
      return;
    }
    if (presetThreshold && Number.isFinite(presetThreshold)) {
      pending.threshold = presetThreshold;
      pending.type = "alert_source";
      saveState();
      await sendMessage(chatId, `⚡ **±${presetThreshold}%**\n\nИсточник:`, sourceKeyboard());
      return;
    }
    pending.type = "alert_threshold";
    saveState();
    await sendMessage(chatId, thresholdPrompt(kind));
    return;
  }

  if (data.startsWith("source:")) {
    const source = data.slice(7);
    const pending = state.users[userId].awaitingInput;
    if (!pending || pending.type !== "alert_source") return;
    pending.source = source;
    pending.type = "alert_repeat";
    saveState();
    await sendMessage(chatId, "**Повтор алерта:**", repeatKeyboard());
    return;
  }

  if (data.startsWith("repeat:")) {
    const repeat = data.slice(7);
    const pending = state.users[userId].awaitingInput;
    if (!pending || pending.type !== "alert_repeat") return;
    pending.repeat = repeat;
    await finalizeAlert(userId, chatId, pending.source, repeat);
    return;
  }

  if (data.startsWith("set:")) {
    await applySetting(userId, chatId, data.slice(4));
    return;
  }

  if (data.startsWith("del:")) {
    removeAlert(userId, data.slice(4));
    await sendMessage(chatId, "🗑 Удалено\n\n" + alertsText(userId), alertsKeyboard(userId));
    return;
  }

  if (data.startsWith("unwatch:")) {
    removeWatch(userId, data.slice(8));
    await sendMessage(chatId, "🗑 Убрано\n\n" + watchlistText(userId), watchlistKeyboard(userId));
  }
}

async function handleAwaitingInput(userId, chatId, text) {
  const pending = state.users[userId].awaitingInput;
  if (!pending) {
    if (isTonAddress(text) || /^[A-Za-z0-9$]{2,12}$/.test(text)) {
      await sendPrice(chatId, userId, text);
      return;
    }
    await sendMessage(chatId, "/help", mainKeyboard());
    return;
  }
  if (pending.type === "alert_token") await handleTokenInput(userId, chatId, text);
  else if (pending.type === "watch_token") await handleWatchTokenInput(userId, chatId, text);
  else if (pending.type === "alert_threshold") await handleThresholdInput(userId, chatId, text, pending);
}

async function handleTokenInput(userId, chatId, text) {
  try {
    const resolved = await resolveAsset(text);
    if (!resolved) {
      await sendMessage(chatId, "Не найдено. Попробуй NOT или EQ...");
      return;
    }
    if (resolved.multiple?.length) {
      await sendMessage(chatId, "Выбери:", pickKeyboard(resolved.multiple));
      return;
    }
    await continueWithAsset(userId, chatId, resolved.address, resolved);
  } catch (error) {
    await sendMessage(chatId, error.message);
  }
}

async function continueWithAsset(userId, chatId, address, assetMeta = null) {
  const prices = await getJettonPrices(address);
  const asset = assetMeta || { address, symbol: prices.symbol, name: prices.name };
  state.users[userId].awaitingInput = {
    type: "alert_kind",
    address: asset.address,
    symbol: asset.symbol,
    name: asset.name,
    basePriceUsd: pickPriceUsd(prices, "avg"),
    baseVolume: prices.market?.volumeUsd24h
  };
  saveState();
  await sendMessage(chatId, `${formatPricesMessage(prices, { lang: getLang(userId) })}\n\n**Тип алерта:**`, kindKeyboard());
}

function kindKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: `⚡ ±${CFG.BIG_MOVE_PCT}%`, callback_data: `template:swing_pct:${CFG.BIG_MOVE_PCT}` },
        { text: "🕵️ Памп", callback_data: "template:pump" },
        { text: `⚠️ Спред ${CFG.SPREAD_WARN_PCT}%`, callback_data: `template:spread_dex:${CFG.SPREAD_WARN_PCT}` }
      ],
      [{ text: "📈 Выше USD", callback_data: "kind:above" }, { text: "📉 Ниже USD", callback_data: "kind:below" }],
      [{ text: "🚀 Рост %", callback_data: "kind:rise_pct" }, { text: "💥 Падение %", callback_data: "kind:drop_pct" }],
      [{ text: `⚡ Резко ±${CFG.BIG_MOVE_PCT}%`, callback_data: `kind:swing_pct:${CFG.BIG_MOVE_PCT}` }],
      [{ text: "🕵️ Памп/ч", callback_data: "kind:pump" }, { text: "↔️ Спред DEX", callback_data: "kind:spread_dex" }],
      [{ text: "📊 Объём ↑", callback_data: "kind:volume_spike" }, { text: "💧 Ликвид. ↓", callback_data: "kind:liquidity_below" }],
      [{ text: "🆕 Новый пул", callback_data: "kind:new_pool" }, { text: "🐋 Кит", callback_data: "kind:whale" }]
    ]
  };
}

function sourceKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📊 Средняя", callback_data: "source:avg" }],
      [{ text: "STON", callback_data: "source:ston" }, { text: "DeDust", callback_data: "source:dedust" }, { text: "Tonco", callback_data: "source:tonco" }]
    ]
  };
}

function repeatKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🔂 Снова", callback_data: "repeat:always" }, { text: "📅 Раз в день", callback_data: "repeat:daily" }],
      [{ text: "1️⃣ Один раз", callback_data: "repeat:once" }]
    ]
  };
}

function thresholdPrompt(kind) {
  const map = {
    above: "💵 Цена USD (выше):",
    below: "💵 Цена USD (ниже):",
    rise_pct: "📈 Рост %:",
    drop_pct: "📉 Падение %:",
    swing_pct: `⚡ Резкое изменение % (±):`,
    volume_spike: `📊 Рост объёма % (по умолч. ${CFG.VOLUME_SPIKE_PCT}):`,
    liquidity_below: "💧 Ликвидность ниже (TON):",
    whale: `🐋 Порог кита (TON, по умолч. ${CFG.WHALE_MIN_TON}):`,
    spread_dex: `↔️ Спред DEX % (по умолч. ${CFG.SPREAD_WARN_PCT}):`
  };
  return map[kind] || "Введи порог:";
}

async function handleThresholdInput(userId, chatId, text, pending) {
  let value = Number(text.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) {
    if (pending.kind === "volume_spike") value = CFG.VOLUME_SPIKE_PCT;
    else if (pending.kind === "whale") value = CFG.WHALE_MIN_TON;
    else {
      await sendMessage(chatId, "Число > 0 или /cancel");
      return;
    }
  }
  pending.threshold = value;
  pending.type = pending.kind === "new_pool" ? "alert_repeat" : "alert_source";
  saveState();
  if (pending.kind === "new_pool" || pending.kind === "spread_dex") {
    pending.source = "avg";
    await sendMessage(chatId, "**Повтор:**", repeatKeyboard());
  } else {
    await sendMessage(chatId, "**Источник:**", sourceKeyboard());
  }
}

async function finalizeAlert(userId, chatId, source, repeat = "once") {
  const pending = state.users[userId].awaitingInput;
  if (!pending) return;
  if (getAlerts(userId).length >= alertLimit(userId)) {
    state.users[userId].awaitingInput = null;
    saveState();
    await sendMessage(chatId, `Макс. **${alertLimit(userId)}** алертов`, mainKeyboard());
    return;
  }
  const alert = {
    id: `a-${Date.now()}`,
    address: pending.address,
    symbol: pending.symbol,
    name: pending.name,
    source: source || "avg",
    kind: pending.kind,
    threshold: pending.threshold,
    repeat,
    basePriceUsd: pending.basePriceUsd,
    baseVolume: pending.baseVolume,
    createdAt: new Date().toISOString(),
    active: true,
    lastPriceUsd: pending.basePriceUsd,
    triggeredAt: null
  };
  getAlerts(userId).push(alert);
  state.users[userId].awaitingInput = null;
  saveState();
  await sendMessage(chatId, `✅ **Алерт**\n${formatAlertLine(alert)}`, mainKeyboard());
}

async function sendCompare(chatId, userId, q1, q2) {
  try {
    const [a1, a2] = await Promise.all([resolveAsset(q1), resolveAsset(q2)]);
    if (!a1?.address || !a2?.address) {
      await sendMessage(chatId, "Не найден один из токенов. Пример: `/compare NOT DOGS`");
      return;
    }
    const [p1, p2] = await Promise.all([getJettonPrices(a1.address), getJettonPrices(a2.address)]);
    const c1 = pickPriceUsd(p1, "avg");
    const c2 = pickPriceUsd(p2, "avg");
    recordPrice(state, a1.address, c1);
    recordPrice(state, a2.address, c2);
    saveState();
    const tz = getTimezoneOffset(userId);
    const s1 = getMarketStats(state, a1.address, c1, tz);
    const s2 = getMarketStats(state, a2.address, c2, tz);
    const lines = [
      "⚖️ **Сравнение**",
      "",
      `**${escapeMd(p1.symbol)}** · ${formatPriceUsd(c1)} · день ${formatChangePct(s1.dayChangePct)}`,
      `**${escapeMd(p2.symbol)}** · ${formatPriceUsd(c2)} · день ${formatChangePct(s2.dayChangePct)}`,
      ""
    ];
    if (c1 && c2) {
      const ratio = c1 / c2;
      lines.push(`1 ${p1.symbol} ≈ **${ratio.toFixed(4)}** ${p2.symbol}`);
    }
    if (p1.spread != null) lines.push(`↔️ Спред ${p1.symbol}: **${p1.spread.toFixed(1)}%**`);
    if (p2.spread != null) lines.push(`↔️ Спред ${p2.symbol}: **${p2.spread.toFixed(1)}%**`);
    await sendMessage(chatId, lines.join("\n"), mainKeyboard());
  } catch (e) {
    await sendMessage(chatId, `Ошибка: ${e.message}`);
  }
}

async function sendSpreadInfo(chatId, userId, query) {
  const resolved = await resolveAsset(query);
  if (!resolved?.address) {
    await sendMessage(chatId, "Не найдено");
    return;
  }
  const prices = await getJettonPrices(resolved.address);
  const spread = prices.spread;
  const lines = [
    `↔️ **Спред DEX · ${escapeMd(prices.symbol)}**`,
    "",
    spread != null ? `Сейчас: **${spread.toFixed(2)}%**` : "_Недостаточно котировок на 2+ DEX_",
    "",
    prices.ston?.priceUsd ? `STON: ${formatPriceUsd(prices.ston.priceUsd)}` : null,
    prices.dedust?.priceUsd ? `DeDust: ${formatPriceUsd(prices.dedust.priceUsd)}` : null,
    prices.tonco?.priceUsd ? `Tonco: ${formatPriceUsd(prices.tonco.priceUsd)}` : null,
    prices.bestBuy ? `\n🛒 Дешевле: **${prices.bestBuy.dex}**` : null,
    "",
    `Алерт: /add → ${escapeMd(prices.symbol)} → «Спред DEX»`
  ].filter(Boolean);
  await sendMessage(chatId, lines.join("\n"), priceKeyboard(resolved.address, prices));
}

async function sendExportWatchlist(chatId, userId) {
  const list = getWatchlist(userId);
  if (!list.length) {
    await sendMessage(chatId, "Дайджест пуст · `/watch NOT, GRM`");
    return;
  }
  const text = list.map((w) => w.symbol).join(", ");
  await sendMessage(
    chatId,
    ["📤 **Твой watchlist**", "", `\`${text}\``, "", "Импорт: `/watch " + text + "`"].join("\n"),
    mainKeyboard()
  );
}

async function sendPrice(chatId, userId, query) {
  const resolved = await resolveAsset(query);
  if (!resolved) {
    await sendMessage(chatId, "Не найдено");
    return;
  }
  if (resolved.multiple?.length) {
    await sendMessage(chatId, "Выбери:", pickKeyboard(resolved.multiple));
    return;
  }
  await sendPriceCard(chatId, userId, resolved.address);
}

async function sendPriceCard(chatId, userId, address) {
  try {
    const prices = await getJettonPrices(address);
    recordApiSuccess("ston");
    const current = pickPriceUsd(prices, "avg");
    if (current) recordPrice(state, address, current);
    saveState();
    let assetMeta = null;
    try {
      assetMeta = await getStonAssetByAddress(address);
    } catch {
      // optional
    }
    const spark = sparklineFromSamples(state.market?.[address]?.samples);
    const text = formatPricesMessage(prices, { lang: getLang(userId), spark, assetMeta });
    await sendMessage(chatId, text, priceKeyboard(address, prices));
  } catch (error) {
    recordApiFailure("ston");
    await sendMessage(chatId, `Ошибка: ${error.message}`);
  }
}

function formatTopRow(row) {
  const sym = row.address ? mdLink(row.symbol, stonAssetUrl(row.address)) : row.symbol;
  return `${sym} ${formatChangePct(row.change)} · ${formatPriceUsd(row.price)}`;
}

async function sendTop(chatId, userId) {
  const rows = await getTopMovers(state, CFG.TOKENS.top_track_symbols, getTimezoneOffset(userId));
  const gainers = rows.filter((r) => Number.isFinite(r.change) && r.change > 0).sort((a, b) => b.change - a.change).slice(0, 5);
  const losers = rows.filter((r) => Number.isFinite(r.change) && r.change < 0).sort((a, b) => a.change - b.change).slice(0, 5);
  const lines = ["📊 **Топ TON jetton'ов**", "", "🚀 **Рост**"];
  if (gainers.length) {
    for (const r of gainers) lines.push(formatTopRow(r));
  } else {
    lines.push("_Сегодня без роста по дню_");
  }
  lines.push("", "💥 **Падение**");
  if (losers.length) {
    for (const r of losers) lines.push(formatTopRow(r));
  } else {
    lines.push("_Сегодня всё в плюсе — явных падений нет_");
  }
  lines.push("", `/price SYMBOL · ${botMention()}`);
  await sendMessage(chatId, lines.join("\n"), mainKeyboard());
}

async function sendNewTokens(chatId, userId) {
  const { fetchRecentAssets } = require("./lib/pools");
  const assets = await fetchRecentAssets(25);
  const lines = ["📋 **Популярные jetton'ы на STON**", "_Не путать с «новыми листингами» — см. алерт «Новый пул»_", ""];
  for (const a of assets.slice(0, 12)) {
    lines.push(`• **${a.symbol}** · ${a.display_name || ""}`);
  }
  lines.push("", `/price SYMBOL · ${botMention()}`);
  await sendMessage(chatId, lines.join("\n"), mainKeyboard());
}

function beginAddAlert(userId) {
  ensureUser(userId);
  state.users[userId].awaitingInput = { type: "alert_token" };
  saveState();
}

function beginAddWatch(userId) {
  ensureUser(userId);
  state.users[userId].awaitingInput = { type: "watch_token" };
  saveState();
}

async function handleWatchTokenInput(userId, chatId, text) {
  if (text.includes(",")) {
    await importWatchlist(userId, chatId, text);
    return;
  }
  await addWatchByQuery(userId, chatId, text);
}

async function addWatchByQuery(userId, chatId, query, silent = false) {
  const resolved = await resolveAsset(query);
  if (!resolved?.address) {
    if (!silent) await sendMessage(chatId, "Не найдено");
    return;
  }
  if (resolved.multiple?.length) {
    if (!silent) await sendMessage(chatId, "Выбери:", pickKeyboard(resolved.multiple));
    return;
  }
  await finalizeWatch(userId, chatId, resolved.address, resolved, silent);
}

async function importWatchlist(userId, chatId, text, silent = false) {
  const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
  const assets = await resolveMany(parts);
  let added = 0;
  for (const asset of assets) {
    if (getWatchlist(userId).length >= watchLimit(userId)) break;
    if (getWatchlist(userId).some((w) => w.address === asset.address)) continue;
    getWatchlist(userId).push({
      address: asset.address,
      symbol: asset.symbol,
      name: asset.name,
      source: "avg",
      addedAt: new Date().toISOString()
    });
    added += 1;
  }
  state.users[userId].awaitingInput = null;
  saveState();
  if (!silent) await sendMessage(chatId, `✅ Добавлено: **${added}**`, watchlistKeyboard(userId));
}

async function finalizeWatch(userId, chatId, address, assetMeta = null, silent = false) {
  const prices = await getJettonPrices(address);
  if (getWatchlist(userId).some((w) => w.address === address)) {
    state.users[userId].awaitingInput = null;
    saveState();
    if (!silent) await sendMessage(chatId, `📬 **${prices.symbol}** уже в списке`);
    return;
  }
  if (getWatchlist(userId).length >= watchLimit(userId)) {
    if (!silent) await sendMessage(chatId, `Лимит **${watchLimit(userId)}** токенов`);
    return;
  }
  getWatchlist(userId).push({
    address,
    symbol: assetMeta?.symbol || prices.symbol,
    name: assetMeta?.name || prices.name,
    source: "avg",
    addedAt: new Date().toISOString()
  });
  state.users[userId].awaitingInput = null;
  saveState();
  const current = pickPriceUsd(prices, "avg");
  if (current) recordPrice(state, address, current);
  if (!silent) {
    const u = state.users[userId];
    await sendMessage(
      chatId,
      `✅ **${prices.symbol}** в дайджесте\n🕘 ${u.digestMorning ?? CFG.DIGEST_MORNING_HOUR}:00 / ${u.digestEvening ?? CFG.DIGEST_EVENING_HOUR}:00\n\n${formatDigestTokenBlock({ symbol: prices.symbol, address, source: "avg" }, prices, state, getTimezoneOffset(userId), getLang(userId))}`,
      mainKeyboard()
    );
  }
}

async function createBatchWatchlistAlerts(userId, chatId) {
  const list = getWatchlist(userId);
  if (!list.length) {
    await sendMessage(chatId, "Сначала `/watch NOT` или дайджест");
    return;
  }
  let n = 0;
  for (const item of list) {
    if (getAlerts(userId).length >= alertLimit(userId)) break;
    const dup = getAlerts(userId).some(
      (a) => a.address === item.address && a.kind === "swing_pct" && a.threshold === CFG.BIG_MOVE_PCT
    );
    if (dup) continue;
    const prices = await getJettonPrices(item.address);
    getAlerts(userId).push({
      id: `a-${Date.now()}-${n}`,
      address: item.address,
      symbol: item.symbol,
      name: item.name,
      source: "avg",
      kind: "swing_pct",
      threshold: CFG.BIG_MOVE_PCT,
      repeat: "daily",
      basePriceUsd: pickPriceUsd(prices, "avg"),
      active: true,
      createdAt: new Date().toISOString()
    });
    n += 1;
  }
  saveState();
  await sendMessage(chatId, `✅ Пакет: **${n}** алертов ±${CFG.BIG_MOVE_PCT}% (раз в день)`, mainKeyboard());
}

function getAlerts(userId) {
  return state.users[userId]?.alerts || [];
}

function getWatchlist(userId) {
  return state.users[userId]?.watchlist || [];
}

function removeAlert(userId, id) {
  state.users[userId].alerts = getAlerts(userId).filter((a) => a.id !== id);
  saveState();
}

function removeWatch(userId, address) {
  state.users[userId].watchlist = getWatchlist(userId).filter((w) => w.address !== address);
  saveState();
}

function watchLimit(userId) {
  const refs = state.users[userId]?.referralCount || 0;
  return CFG.WATCH_LIMIT + refs * CFG.WATCH_BONUS_PER_REFERRAL;
}

function alertLimit(userId) {
  const refs = state.users[userId]?.referralCount || 0;
  return CFG.ALERT_LIMIT + refs * (CFG.REFERRAL_ALERT_BONUS || 1);
}

function getTrackedItemsForPools() {
  const map = new Map();
  for (const user of Object.values(state.users)) {
    for (const a of user.alerts || []) {
      if (a.active) map.set(a.address, { address: a.address, symbol: a.symbol });
    }
    for (const w of user.watchlist || []) map.set(w.address, { address: w.address, symbol: w.symbol });
  }
  for (const p of CFG.TOKENS.presets || []) map.set(p.address, { address: p.address, symbol: p.symbol });
  return [...map.values()];
}

function snapshotVisitPrices(userId) {
  const u = state.users[userId];
  if (!u) return;
  const snap = {};
  for (const w of u.watchlist || []) {
    const p = state.market?.[w.address]?.samples?.slice(-1)[0]?.p;
    if (p) snap[w.address] = { symbol: w.symbol, price: p };
  }
  for (const p of CFG.TOKENS.presets || []) {
    const price = state.market?.[p.address]?.samples?.slice(-1)[0]?.p;
    if (price) snap[p.address] = { symbol: p.symbol, price };
  }
  u.lastVisitSnap = snap;
  u.lastVisitAt = Date.now();
}

function sinceLastVisitBlock(userId) {
  const u = state.users[userId];
  const prev = u?.lastVisitSnap;
  if (!prev || !Object.keys(prev).length) return "";
  const lines = [t(getLang(userId), "since_last_visit"), ""];
  let any = false;
  for (const [addr, meta] of Object.entries(prev)) {
    const current = state.market?.[addr]?.samples?.slice(-1)[0]?.p;
    if (!current || !meta.price) continue;
    const ch = ((current - meta.price) / meta.price) * 100;
    if (!Number.isFinite(ch)) continue;
    any = true;
    lines.push(`• **${escapeMd(meta.symbol)}** ${formatChangePct(ch)} · ${formatPriceUsd(current)}`);
  }
  if (!any) return "";
  lines.push("");
  return lines.join("\n");
}

function queueAlert(userId, result) {
  ensureUser(userId);
  const u = state.users[userId];
  if (!u.pendingAlerts) u.pendingAlerts = [];
  u.pendingAlerts.push({ ...result, queuedAt: Date.now() });
  if (u.pendingAlerts.length > 20) u.pendingAlerts = u.pendingAlerts.slice(-20);
  saveState();
}

async function flushPendingAlerts(userId, chatId) {
  const u = state.users[userId];
  const batch = u?.pendingAlerts || [];
  if (!batch.length) return;
  u.pendingAlerts = [];
  saveState();
  await sendMessage(
    chatId,
    t(getLang(userId), "queued_alerts", { n: batch.length }),
    mainKeyboard()
  );
  for (const item of batch.slice(0, 5)) {
    await sendAlertNotification(chatId, item, true);
  }
  if (batch.length > 5) {
    await sendMessage(chatId, `_Ещё ${batch.length - 5} — открой /list_`);
  }
}

function ensureUser(userId) {
  if (!state.users[userId]) {
    state.users[userId] = {
      alerts: [],
      watchlist: [],
      digest: { lastMorning: null, lastEvening: null, lastWeekly: null },
      timezoneOffset: CFG.DEFAULT_TIMEZONE_OFFSET,
      digestMorning: CFG.DIGEST_MORNING_HOUR,
      digestEvening: CFG.DIGEST_EVENING_HOUR,
      lang: "ru",
      onboarded: false,
      referralCode: `u${userId.slice(-6)}`,
      referralCount: 0,
      awaitingInput: null,
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    };
  }
  const u = state.users[userId];
  if (!u.alerts) u.alerts = [];
  if (!u.watchlist) u.watchlist = [];
  if (!u.digest) u.digest = { lastMorning: null, lastEvening: null, lastWeekly: null };
  if (!u.referralCode) u.referralCode = `u${userId.slice(-6)}`;
  if (u.quietHoursEnabled == null) u.quietHoursEnabled = true;
  if (!u.pendingAlerts) u.pendingAlerts = [];
}

function touchUser(userId) {
  ensureUser(userId);
  const u = state.users[userId];
  ADMIN.touchActivity(u);
  if (ADMIN.shouldPersistActivity(u)) {
    ADMIN.markActivitySaved(u);
    saveState();
  }
}

function adminStatsText() {
  const users = state.users || {};
  const withAlerts = Object.values(users).filter((u) => (u.alerts || []).length > 0).length;
  const withWatch = Object.values(users).filter((u) => (u.watchlist || []).length > 0).length;
  const onboarded = Object.values(users).filter((u) => u.onboarded).length;
  return ADMIN.buildAdminStats({
    title: "Price Tons · admin",
    users,
    extraLines: [
      "",
      `🔔 С алертами: **${withAlerts}**`,
      `📬 С дайджестом: **${withWatch}**`,
      `✅ Онбординг пройден: **${onboarded}**`
    ]
  });
}

function applyReferral(userId, code) {
  ensureUser(userId);
  if (state.users[userId].referredBy) return;
  for (const [id, user] of Object.entries(state.users)) {
    if (user.referralCode === code && id !== userId) {
      state.users[userId].referredBy = code;
      user.referralCount = (user.referralCount || 0) + 1;
      saveState();
      return;
    }
  }
}

function getLang(userId) {
  return state.users[userId]?.lang || "ru";
}

function getTimezoneOffset(userId) {
  return state.users[userId]?.timezoneOffset ?? CFG.DEFAULT_TIMEZONE_OFFSET;
}

function getLocalHour(userId, date = new Date()) {
  const local = new Date(date.getTime() + getTimezoneOffset(userId) * 3600_000);
  return local.getUTCHours();
}

function getLocalDay(userId, date = new Date()) {
  return dayKey(date, getTimezoneOffset(userId));
}

function alertsText(userId) {
  const alerts = getAlerts(userId);
  if (!alerts.length) return "📭 Нет алертов · `/add`";
  return [`🔔 **Алерты** (${alerts.length}/${alertLimit(userId)})`, "", ...alerts.map((a, i) => `${i + 1}. ${formatAlertLine(a)}`)].join("\n");
}

function formatAlertLine(alert) {
  const rep = { once: "1×", daily: "📅", always: "🔂" }[alert.repeat || "once"];
  return `**${alert.symbol}** · ${kindLabel(alert)} · ${rep}${alert.lastPriceUsd ? ` · ${formatPriceUsd(alert.lastPriceUsd)}` : ""}`;
}

function alertsKeyboard(userId) {
  const rows = getAlerts(userId).map((a) => [{ text: `🗑 ${a.symbol}`, callback_data: `del:${a.id}` }]);
  rows.push([{ text: "➕ Алерт", callback_data: "menu:add" }]);
  return { inline_keyboard: rows };
}

function watchlistText(userId) {
  const list = getWatchlist(userId);
  const u = state.users[userId];
  if (!list.length) return "📭 Пусто · `/watch NOT, GRM`";
  return [
    `📬 **Дайджест** (${list.length}/${watchLimit(userId)})`,
    `🕘 ${u.digestMorning}:00 · ${u.digestEvening}:00 UTC${getTimezoneOffset(userId) >= 0 ? "+" : ""}${getTimezoneOffset(userId)}`,
    "",
    ...list.map((w, i) => `${i + 1}. **${w.symbol}**`)
  ].join("\n");
}

function watchlistKeyboard(userId) {
  const rows = getWatchlist(userId).map((w) => [{ text: `🗑 ${w.symbol}`, callback_data: `unwatch:${w.address}` }]);
  rows.push(
    [{ text: "➕ В дайджест", callback_data: "menu:watch" }],
    [{ text: "📤 Экспорт", callback_data: "menu:export" }]
  );
  return { inline_keyboard: rows };
}

function settingsText(userId) {
  const u = state.users[userId];
  const qh = u.quietHoursEnabled !== false;
  return [
    "⚙️ **Настройки**",
    `🌍 UTC${getTimezoneOffset(userId) >= 0 ? "+" : ""}${getTimezoneOffset(userId)}`,
    `🌅 Дайджест: **${u.digestMorning}**:00 · **${u.digestEvening}**:00`,
    `🗣 Язык: **${u.lang === "en" ? "English" : "Русский"}**`,
    t(getLang(userId), "quiet_hours", { start: CFG.QUIET_HOURS_START, end: CFG.QUIET_HOURS_END }) +
      (qh ? " ✅" : " ❌"),
    `🎁 Рефералов: **${u.referralCount || 0}** (+${(u.referralCount || 0) * CFG.WATCH_BONUS_PER_REFERRAL} дайджест · +${(u.referralCount || 0) * (CFG.REFERRAL_ALERT_BONUS || 1)} алерт)`
  ].join("\n");
}

function settingsKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "UTC+2", callback_data: "set:tz:2" }, { text: "UTC+3", callback_data: "set:tz:3" }, { text: "UTC+4", callback_data: "set:tz:4" }],
      [{ text: "🌅 8:00", callback_data: "set:morn:8" }, { text: "🌅 9:00", callback_data: "set:morn:9" }, { text: "🌅 10:00", callback_data: "set:morn:10" }],
      [{ text: "🌙 19:00", callback_data: "set:eve:19" }, { text: "🌙 20:00", callback_data: "set:eve:20" }, { text: "🌙 21:00", callback_data: "set:eve:21" }],
      [{ text: "🇷🇺 RU", callback_data: "set:lang:ru" }, { text: "🇬🇧 EN", callback_data: "set:lang:en" }],
      [{ text: "🌙 Тихие часы вкл", callback_data: "set:quiet:1" }, { text: "🌙 Выкл", callback_data: "set:quiet:0" }]
    ]
  };
}

async function applySetting(userId, chatId, payload) {
  const [key, val] = payload.split(":");
  const u = state.users[userId];
  if (key === "tz") u.timezoneOffset = Number(val);
  if (key === "morn") u.digestMorning = Number(val);
  if (key === "eve") u.digestEvening = Number(val);
  if (key === "lang") u.lang = val;
  if (key === "quiet") u.quietHoursEnabled = val === "1";
  saveState();
  await sendMessage(chatId, settingsText(userId), settingsKeyboard());
}

function onboardingKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "NOT", callback_data: "onboard:not" }, { text: "GRM", callback_data: "onboard:grm" }],
      [{ text: "NOT + GRM", callback_data: "onboard:both" }, { text: "Пропустить", callback_data: "onboard:skip" }]
    ]
  };
}

function mainKeyboard() {
  return {
    keyboard: [
      [{ text: "💎 Цена" }, { text: "📊 Топ" }],
      [{ text: "NOT" }, { text: "GRM" }, { text: "DOGS" }],
      [{ text: "➕ Алерт" }, { text: "📬 Дайджест" }],
      [{ text: "📋 Алерты" }, { text: "⚙️ Настройки" }],
      [{ text: "☕ Поддержать" }, { text: "❓ Помощь" }]
    ],
    resize_keyboard: true
  };
}

function pickKeyboard(assets) {
  return {
    inline_keyboard: assets.map((a) => [{ text: `${a.symbol} · ${a.name}`, callback_data: `pick:${a.address}` }])
  };
}

function welcomeText(userId) {
  return [
    `💎 **Price Tons** · ${botMention()}`,
    "",
    "STON · DeDust · **Tonco** · алерты · дайджест 2×/день",
    "",
    "`/grm` · `/top` · `/compare` · `/spread` · `/settings`",
    "",
    t(getLang(userId), "free"),
    `Дайджест: до **${watchLimit(userId)}** токенов`
  ].join("\n");
}

function helpText(userId) {
  return [
    "❓ **Команды**",
    "`/price` `/grm` `/top` `/compare` `/spread`",
    "`/add` `/alertbatch` `/list`",
    "`/watch NOT, GRM` · `/watchlist` · `/exportwatchlist`",
    "`/guide` — база знаний 🎭",
    "`/settings` `/ref` `/support`",
    "",
    "⚠️ **Рейтинг риска** — в каждой карточке цены",
    "🕵️ **Памп-алерты** — рост ≥200%/час",
    "🔍 **Проверить контракт** — TONScan / GeckoTerminal",
    "",
    "**Inline:** `@Price_Tons_bot NOT` в любом чате",
    "_(сначала включи Inline Mode в @BotFather → /setinline)_",
    "",
    `Алерты: цена, %, ±${CFG.BIG_MOVE_PCT}%, спред DEX, объём, **памп**, кит`,
    "🌙 Тихие часы — алерты копятся до утра",
    "Повтор: один раз · раз в день · снова",
    "",
    `🎧 [Radio Gram](${CFG.RADIO_GRAM_URL})`
  ].join("\n");
}

function supportText() {
  return [
    "☕ **Поддержать разработчика**",
    "",
    "Если бот помогает — можно угостить 🙂",
    "",
    "💎 **TON** — кнопка ниже скопирует кошелёк",
    "💳 **СБП / карта** — CloudTips",
    "",
    `\`${CFG.TON_WALLET}\``
  ].join("\n");
}

function supportKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "💎 TON-кошелёк (скопировать)", copy_text: { text: CFG.TON_WALLET } }],
      [{ text: "💳 СБП карта", url: CFG.SUPPORT_URL }]
    ]
  };
}

async function sendSupport(chatId) {
  await sendMessage(chatId, supportText(), supportKeyboard());
}

function referralText(userId) {
  const code = state.users[userId].referralCode;
  return [
    "🎁 **Рефералка**",
    "",
    `Ссылка: \`https://t.me/${CFG.BOT_USERNAME}?start=ref_${code}\``,
    "",
    t(getLang(userId), "referral_bonus", {
      n: CFG.WATCH_BONUS_PER_REFERRAL,
      a: CFG.REFERRAL_ALERT_BONUS || 1
    }),
    `Дайджест: **${watchLimit(userId)}** · алертов: **${alertLimit(userId)}**`
  ].join("\n");
}

const PICK = {
  price_prompt: "Тикер или адрес:\n\n`/price NOT`",
  add_alert: "🔔 Тикер для алерта:",
  add_watch: "📬 Тикер(ы) через запятую:\n`NOT, GRM, DOGS`",
  no_alerts: "Нет алертов",
  no_watch: "Дайджест пуст",
  pick_delete: "Удалить:",
  pick_unwatch: "Убрать:",
  cancelled: "Отменено"
};

function pickText(userId, key) {
  return PICK[key] || key;
}

function getTrackedAddresses() {
  const set = new Set();
  for (const user of Object.values(state.users)) {
    for (const a of user.alerts || []) {
      if (a.active) set.add(a.address);
    }
    for (const w of user.watchlist || []) set.add(w.address);
  }
  for (const p of CFG.TOKENS.presets || []) set.add(p.address);
  return [...set];
}

function startLoops() {
  setInterval(() => tickMarketLoop().catch((e) => console.error(e.message)), CFG.CHECK_INTERVAL_MS);
  setInterval(() => backupState(STATE_PATH, DATA_DIR), CFG.BACKUP_EVERY_MS);
  tickMarketLoop().catch(console.error);
}

async function tickMarketLoop() {
  const addresses = getTrackedAddresses();
  const priceByAddress = new Map();

  for (const address of addresses) {
    try {
      const prices = await getJettonPrices(address);
      recordApiSuccess("ston");
      priceByAddress.set(address, prices);
      const current = pickPriceUsd(prices, "avg");
      if (current) recordPrice(state, address, current);
      recordWhaleSignals(state, address, prices);
    } catch {
      recordApiFailure("ston");
    }
  }

  await scanNewPools(state, getTrackedItemsForPools());

  const pumpNotified = new Set();
  for (const address of addresses) {
    const prices = priceByAddress.get(address);
    if (!prices) continue;
    try {
      const pumpResult = detectAutoPump(state, address, prices, CFG.DEFAULT_TIMEZONE_OFFSET);
      if (pumpResult && !pumpNotified.has(address)) {
        pumpNotified.add(address);
        await notifyPumpWatchers(address, pumpResult);
      }
    } catch {
      // skip
    }
  }

  for (const [userId, user] of Object.entries(state.users)) {
    const tz = getTimezoneOffset(userId);
    const localHour = getLocalHour(userId);
    if (localHour === CFG.QUIET_HOURS_END && user.pendingAlerts?.length) {
      await flushPendingAlerts(userId, Number(userId));
    }
    for (const alert of user.alerts || []) {
      if (!alert.active) continue;
      const prices = priceByAddress.get(alert.address);
      if (!prices) continue;
      try {
        const result = await evaluateAlert(alert, prices, state, tz);
        if (result) await sendAlertNotification(Number(userId), result);
      } catch (e) {
        console.error("alert", e.message);
      }
    }
  }

  await checkDigests();
  await checkWeekly();
  await maybeChannelPost(priceByAddress);
  if (shouldNotifyAdmin() && CFG.ADMIN_CHAT_ID) {
    await sendMessage(Number(CFG.ADMIN_CHAT_ID), adminAlertMessage());
  }
  saveState();
}

async function checkDigests() {
  for (const [userId, user] of Object.entries(state.users)) {
    if (!user.watchlist?.length) continue;
    const hour = getLocalHour(userId);
    const day = getLocalDay(userId);
    const morn = user.digestMorning ?? CFG.DIGEST_MORNING_HOUR;
    const eve = user.digestEvening ?? CFG.DIGEST_EVENING_HOUR;
    let slot = null;
    if (hour === morn && user.digest.lastMorning !== day) {
      slot = "morning";
      user.digest.lastMorning = day;
    } else if (hour === eve && user.digest.lastEvening !== day) {
      slot = "evening";
      user.digest.lastEvening = day;
    }
    if (!slot) continue;
    if (slot === "morning" && user.pendingAlerts?.length) {
      await flushPendingAlerts(userId, Number(userId));
    }
    if (!digestHasMovement(state, user.watchlist, getTimezoneOffset(userId))) {
      continue;
    }
    const title = slot === "morning" ? t(getLang(userId), "digest_morning") : t(getLang(userId), "digest_evening");
    const lines = [`🌅 **${title}**`, ""];
    for (const item of user.watchlist) {
      try {
        const prices = await getJettonPrices(item.address);
        lines.push(formatDigestTokenBlock(item, prices, state, getTimezoneOffset(userId), getLang(userId)));
        lines.push("");
      } catch (e) {
        lines.push(`⚠️ ${item.symbol}: ${e.message}`);
      }
    }
    await sendMessage(Number(userId), lines.join("\n").trim(), mainKeyboard());
  }
}

async function checkWeekly() {
  for (const [userId, user] of Object.entries(state.users)) {
    if (!user.watchlist?.length) continue;
    const local = new Date(Date.now() + getTimezoneOffset(userId) * 3600_000);
    const isSunday = local.getUTCDay() === 0;
    const hour = local.getUTCHours();
    const eve = user.digestEvening ?? CFG.DIGEST_EVENING_HOUR;
    const weekKey = dayKey(local, getTimezoneOffset(userId)).slice(0, 7);
    if (!isSunday || hour !== eve || user.digest.lastWeekly === weekKey) continue;
    user.digest.lastWeekly = weekKey;
    const lines = [`📅 **${t(getLang(userId), "weekly")}**`, ""];
    for (const item of user.watchlist) {
      const prices = await getJettonPrices(item.address);
      const stats = getMarketStats(state, item.address, pickPriceUsd(prices, "avg"), getTimezoneOffset(userId));
      lines.push(`**${item.symbol}** · неделя ${formatChangePct(stats.weekChangePct)} · ${formatPriceUsd(pickPriceUsd(prices, "avg"))}`);
    }
    await sendMessage(Number(userId), lines.join("\n"));
  }
}

async function maybeChannelPost(priceByAddress = new Map()) {
  if (!CFG.CHANNEL_ID) return;
  const tz = CFG.DEFAULT_TIMEZONE_OFFSET;
  const day = dayKey(new Date(), tz);
  const grm = CFG.TOKENS.grm?.address;
  if (grm) {
    const prices = priceByAddress.get(grm) || (await getJettonPrices(grm).catch(() => null));
    if (prices) {
      const stats = getMarketStats(state, grm, pickPriceUsd(prices, "avg"), tz);
      if (Math.abs(stats.dayChangePct || 0) >= CFG.CHANNEL_POST_PCT) {
        const key = `grm-${day}`;
        if (!state.channelPosts?.[key]) {
          state.channelPosts = state.channelPosts || {};
          state.channelPosts[key] = true;
          const msg = [
            `📢 **GRM** ${formatChangePct(stats.dayChangePct)} за день`,
            "",
            formatPriceUsd(pickPriceUsd(prices, "avg")),
            "",
            `[Gram Dns](${gramDnsUrl()}) · [Radio Gram](${CFG.RADIO_GRAM_URL}) · ${botMention()}`
          ].join("\n");
          await sendMessage(CFG.CHANNEL_ID, msg);
        }
      }
    }
  }
  const topKey = `top-${day}`;
  if (state.channelPosts?.[topKey]) return;
  try {
    const rows = await getTopMovers(state, CFG.TOKENS.top_track_symbols.slice(0, 6), tz);
    const movers = rows.filter((r) => Number.isFinite(r.change) && Math.abs(r.change) >= 3).slice(0, 3);
    if (!movers.length) return;
    state.channelPosts = state.channelPosts || {};
    state.channelPosts[topKey] = true;
    const lines = ["📊 **Топ движения TON jetton'ов**", ""];
    for (const r of movers) {
      lines.push(`• **${escapeMd(r.symbol)}** ${formatChangePct(r.change)} · ${formatPriceUsd(r.price)}`);
    }
    lines.push("", botMention());
    await sendMessage(CFG.CHANNEL_ID, lines.join("\n"));
  } catch (e) {
    console.error("channel top", e.message);
  }
}

function startHealthServer() {
  http.createServer((_q, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("price-tons-bot ok");
  }).listen(PORT, () => console.log(`Health :${PORT}`));
}

async function startWebhookServer() {
  startLoops();
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === CFG.WEBHOOK_PATH) {
      const body = await readBody(req);
      try {
        const update = JSON.parse(body);
        await handleUpdate(update);
      } catch (e) {
        console.error(e);
      }
      res.writeHead(200);
      res.end("ok");
      return;
    }
    res.writeHead(200);
    res.end("ok");
  });
  server.listen(PORT);
  await telegram("setWebhook", {
    url: `${CFG.PUBLIC_BASE_URL}${CFG.WEBHOOK_PATH}`,
    allowed_updates: ["message", "callback_query", "inline_query"]
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => { data += c; });
    req.on("end", () => resolve(data));
  });
}

async function notifyPumpWatchers(address, result) {
  for (const [userId, user] of Object.entries(state.users)) {
    const inWatch = (user.watchlist || []).some((w) => w.address === address);
    const inAlerts = (user.alerts || []).some((a) => a.address === address && a.active);
    if (!inWatch && !inAlerts) continue;
    try {
      await sendAlertNotification(Number(userId), result);
    } catch (e) {
      console.error("pump notify", userId, e.message);
    }
  }
}

async function sendAlertNotification(chatId, result, skipQuiet = false) {
  const userId = String(chatId);
  const u = state.users[userId];
  if (!skipQuiet && u && isQuietHours(getLocalHour(userId), u.quietHoursEnabled !== false)) {
    queueAlert(userId, result);
    return;
  }
  const pctMatch = result.text.match(/[+-]?\*\*?\d+\.?\d*\*\*?%/);
  const pct = pctMatch ? pctMatch[0].replace(/\*/g, "") : "";
  const art = alertImageBuffer(result.mood, result.symbol, pct);
  const caption = `${result.text}\n\n${botMention()}`.slice(0, 1024);
  if (SELF_TEST) {
    console.log(`[ALERT:${result.mood}] ${result.symbol}`, caption.slice(0, 120));
    return;
  }
  if (art.mime === "image/png") {
    await sendPhotoBuffer(chatId, art.buffer, art.filename, caption, result.keyboard);
  } else {
    await sendMessage(chatId, caption, result.keyboard);
  }
}

async function sendPhotoBuffer(chatId, buffer, filename, caption, replyMarkup) {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("photo", new Blob([buffer], { type: "image/png" }), filename);
  form.append("caption", caption);
  form.append("parse_mode", "Markdown");
  if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));
  const response = await fetch(`${telegramApi}/sendPhoto`, { method: "POST", body: form });
  const data = await response.json();
  if (!data.ok) {
    console.error("sendPhoto failed:", data.description);
    await sendMessage(chatId, caption, replyMarkup);
  }
}

async function sendMessage(chatId, text, replyMarkup = null) {
  const payload = { chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true };
  if (replyMarkup) payload.reply_markup = replyMarkup;
  if (SELF_TEST) {
    console.log(`[${chatId}]`, text.slice(0, 200));
    return;
  }
  await telegram("sendMessage", payload);
}

async function telegram(method, payload = {}) {
  if (SELF_TEST && method !== "getUpdates") return { ok: true, result: [] };
  const response = await fetch(`${telegramApi}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!data.ok) throw new Error(data.description || method);
  return data;
}

function loadState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(STATE_PATH)) return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch (e) {
    console.error(e.message);
  }
  return { users: {}, market: {}, bootAt: Date.now() };
}

function saveState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runSelfTest() {
  console.log("Self-test...\n");
  const { pctChange } = require("./lib/history");
  const drop = pctChange(0.9, 1);
  console.assert(drop != null && drop < 0, "drop_pct direction");
  console.assert(CFG.BIG_MOVE_PCT === 20, "BIG_MOVE_PCT");
  console.assert(alertLimit("test") >= CFG.ALERT_LIMIT, "alertLimit");

  if (process.env.OFFLINE_SELF_TEST === "1") {
    console.log("Offline mode — skip API");
    console.log(welcomeText("test"));
    console.log("\nOK (offline)");
    return;
  }

  const not = await resolveAsset("NOT");
  const addr = not.address || not.multiple?.[0]?.address;
  const prices = await getJettonPrices(addr);
  console.log(formatPricesMessage(prices, { spark: "▁▂▃" }));
  const { assessRisk } = require("./lib/risk");
  console.log("\nRisk:", assessRisk(prices).label);
  const pump = detectAutoPump(state, addr, prices);
  console.log("Pump detect:", pump ? "would fire" : "no");
  ensureUser("test");
  state.users.test.watchlist = [{ address: addr, symbol: "NOT", source: "avg" }];
  console.log(welcomeText("test"));
  console.log("\nGuides:", listGuides().map((g) => g.title).join(", "));
  console.log("\nOK");
}

module.exports = { runSelfTest };
