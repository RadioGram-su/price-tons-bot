const fs = require("fs");
const path = require("path");
const http = require("http");

const { resolveAsset, isTonAddress } = require("./lib/assets");
const {
  getJettonPrices,
  pickPriceUsd,
  formatPriceUsd,
  formatPricesMessage
} = require("./lib/prices");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";
const PORT = Number(process.env.PORT || 8789);
const SELF_TEST = process.argv.includes("--self-test");
const BOT_USERNAME = process.env.BOT_USERNAME || "Price_Tons_bot";
const ALERT_LIMIT = Number(process.env.ALERT_LIMIT || 5);
const CHECK_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 60_000);

const ROOT_DIR = __dirname;
const DATA_DIR = process.env.BOT_DATA_DIR || process.env.DATA_DIR || path.join(ROOT_DIR, "data");
const STATE_PATH = process.env.BOT_STATE_PATH || path.join(DATA_DIR, "state.json");

const state = loadState();

if (!BOT_TOKEN && !SELF_TEST) {
  console.error("Missing TELEGRAM_BOT_TOKEN. Create a bot via @BotFather and set the token.");
  process.exit(1);
}

const telegramApi = `https://api.telegram.org/bot${BOT_TOKEN}`;

(SELF_TEST ? runSelfTest() : main()).catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  startHealthServer();
  startAlertLoop();

  console.log(`@${BOT_USERNAME} started (Price Tons).`);
  let offset = Number(process.env.TELEGRAM_POLLING_OFFSET || 0);

  while (true) {
    try {
      const updates = await telegram("getUpdates", {
        offset,
        timeout: 30,
        allowed_updates: ["message", "callback_query"]
      });

      for (const update of updates.result || []) {
        offset = update.update_id + 1;
        await handleUpdate(update);
      }
    } catch (error) {
      console.error("Polling error:", error.message);
      await wait(1500);
    }
  }
}

async function handleUpdate(update) {
  if (update.callback_query) {
    await handleCallback(update.callback_query);
    return;
  }

  const message = update.message;
  if (!message?.text) return;

  const chatId = message.chat.id;
  const userId = String(message.from.id);
  ensureUser(userId);

  const text = message.text.trim();
  const lower = text.toLowerCase();

  if (lower.startsWith("/start")) {
    await sendMessage(chatId, welcomeText(), mainKeyboard());
    return;
  }

  if (lower.startsWith("/help")) {
    await sendMessage(chatId, helpText(), mainKeyboard());
    return;
  }

  if (lower.startsWith("/price")) {
    const query = text.replace(/^\/price(@\w+)?/i, "").trim();
    if (!query) {
      await sendMessage(chatId, "Напиши: `/price NOT` или `/price EQ...`", mainKeyboard());
      return;
    }
    await sendPrice(chatId, query);
    return;
  }

  if (lower.startsWith("/list") || lower.startsWith("/alerts")) {
    await sendMessage(chatId, alertsText(userId), alertsKeyboard(userId));
    return;
  }

  if (lower.startsWith("/add")) {
    beginAddAlert(userId);
    await sendMessage(chatId, "🔔 **Новый алерт**\n\nНапиши **тикер** (NOT, DOGS) или **адрес jetton** (EQ...).");
    return;
  }

  if (lower.startsWith("/delete") || lower.startsWith("/remove")) {
    const alerts = getAlerts(userId);
    if (!alerts.length) {
      await sendMessage(chatId, "Список алертов пуст.", mainKeyboard());
      return;
    }
    await sendMessage(chatId, "Выбери алерт для удаления:", alertsKeyboard(userId));
    return;
  }

  if (lower.startsWith("/cancel")) {
    state.users[userId].awaitingInput = null;
    saveState();
    await sendMessage(chatId, "Отменено.", mainKeyboard());
    return;
  }

  if (text === "💎 Цена") {
    await sendMessage(chatId, "Напиши тикер или адрес:\n\nПример: `NOT` или `/price DOGS`");
    return;
  }

  if (text === "➕ Алерт") {
    beginAddAlert(userId);
    await sendMessage(chatId, "🔔 **Новый алерт**\n\nНапиши **тикер** (NOT, DOGS) или **адрес jetton** (EQ...).");
    return;
  }

  if (text === "📋 Мои алерты") {
    await sendMessage(chatId, alertsText(userId), alertsKeyboard(userId));
    return;
  }

  if (text === "❓ Помощь") {
    await sendMessage(chatId, helpText(), mainKeyboard());
    return;
  }

  await handleAwaitingInput(userId, chatId, text);
}

async function handleCallback(callback) {
  const data = callback.data || "";
  const chatId = callback.message.chat.id;
  const userId = String(callback.from.id);
  ensureUser(userId);

  await telegram("answerCallbackQuery", { callback_query_id: callback.id }).catch(() => {});

  if (data === "menu:add") {
    beginAddAlert(userId);
    await sendMessage(chatId, "🔔 **Новый алерт**\n\nНапиши **тикер** или **адрес jetton**.");
    return;
  }

  if (data === "menu:list") {
    await sendMessage(chatId, alertsText(userId), alertsKeyboard(userId));
    return;
  }

  if (data === "menu:help") {
    await sendMessage(chatId, helpText(), mainKeyboard());
    return;
  }

  if (data.startsWith("pick:")) {
    const address = data.slice(5);
    const pending = state.users[userId].awaitingInput;
    if (pending?.type === "alert_token" || pending?.type === "alert_kind") {
      await continueWithAsset(userId, chatId, address);
    } else {
      const prices = await getJettonPrices(address);
      await sendMessage(chatId, formatPricesMessage(prices), mainKeyboard());
    }
    return;
  }

  if (data.startsWith("kind:")) {
    const kind = data.slice(5);
    const pending = state.users[userId].awaitingInput;
    if (!pending || pending.type !== "alert_kind") return;
    pending.kind = kind;
    pending.type = "alert_threshold";
    saveState();
    await sendMessage(chatId, thresholdPrompt(kind));
    return;
  }

  if (data.startsWith("source:")) {
    const source = data.slice(7);
    const pending = state.users[userId].awaitingInput;
    if (!pending || pending.type !== "alert_source") return;
    await finalizeAlert(userId, chatId, source);
    return;
  }

  if (data.startsWith("del:")) {
    const alertId = data.slice(4);
    removeAlert(userId, alertId);
    await sendMessage(chatId, "🗑 Алерт удалён.\n\n" + alertsText(userId), alertsKeyboard(userId));
  }
}

async function handleAwaitingInput(userId, chatId, text) {
  const pending = state.users[userId].awaitingInput;
  if (!pending) {
    if (isTonAddress(text) || /^[A-Za-z0-9$]{2,12}$/.test(text)) {
      await sendPrice(chatId, text);
      return;
    }
    await sendMessage(chatId, "Команды: /price, /add, /list, /help", mainKeyboard());
    return;
  }

  if (pending.type === "alert_token") {
    await handleTokenInput(userId, chatId, text);
    return;
  }

  if (pending.type === "alert_threshold") {
    await handleThresholdInput(userId, chatId, text, pending);
    return;
  }
}

async function handleTokenInput(userId, chatId, text) {
  try {
    const resolved = await resolveAsset(text);
    if (!resolved) {
      await sendMessage(chatId, "Не нашёл jetton. Попробуй точный тикер (NOT) или адрес EQ...");
      return;
    }

    if (resolved.multiple?.length) {
      await sendMessage(
        chatId,
        "Нашёл несколько вариантов — выбери:",
        {
          inline_keyboard: resolved.multiple.map((asset) => [
            { text: `${asset.symbol} · ${asset.name}`, callback_data: `pick:${asset.address}` }
          ])
        }
      );
      return;
    }

    await continueWithAsset(userId, chatId, resolved.address, resolved);
  } catch (error) {
    await sendMessage(chatId, `Ошибка поиска: ${error.message}`);
  }
}

async function continueWithAsset(userId, chatId, address, assetMeta = null) {
  const prices = await getJettonPrices(address);
  const asset = assetMeta || {
    address,
    symbol: prices.symbol,
    name: prices.name
  };

  state.users[userId].awaitingInput = {
    type: "alert_kind",
    address: asset.address,
    symbol: asset.symbol,
    name: asset.name,
    basePriceUsd: pickPriceUsd(prices, "avg")
  };
  saveState();

  await sendMessage(
    chatId,
    `${formatPricesMessage(prices)}\n\n**Выбери тип алерта:**`,
    kindKeyboard()
  );
}

function kindKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📈 Цена выше", callback_data: "kind:above" }, { text: "📉 Цена ниже", callback_data: "kind:below" }],
      [{ text: "🚀 Рост на %", callback_data: "kind:rise_pct" }, { text: "💥 Падение на %", callback_data: "kind:drop_pct" }]
    ]
  };
}

function thresholdPrompt(kind) {
  if (kind === "above" || kind === "below") {
    return "💵 Введи **цену в USD** (например `0.00045` или `1.25`):";
  }
  return "📊 Введи **процент** (например `10` для ±10%):";
}

async function handleThresholdInput(userId, chatId, text, pending) {
  const value = Number(text.replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) {
    await sendMessage(chatId, "Нужно положительное число. Попробуй ещё раз или /cancel");
    return;
  }

  if ((pending.kind === "rise_pct" || pending.kind === "drop_pct") && value > 1000) {
    await sendMessage(chatId, "Слишком большой процент. Введи, например, `10`.");
    return;
  }

  pending.threshold = value;
  pending.type = "alert_source";
  saveState();

  await sendMessage(
    chatId,
    "📡 **Источник цены для алерта:**",
    {
      inline_keyboard: [
        [{ text: "📊 Средняя STON+DeDust", callback_data: "source:avg" }],
        [{ text: "🟢 STON.fi", callback_data: "source:ston" }, { text: "🔵 DeDust", callback_data: "source:dedust" }]
      ]
    }
  );
}

async function finalizeAlert(userId, chatId, source) {
  const pending = state.users[userId].awaitingInput;
  if (!pending || pending.type !== "alert_source") return;

  const alerts = getAlerts(userId);
  if (alerts.length >= ALERT_LIMIT) {
    state.users[userId].awaitingInput = null;
    saveState();
    await sendMessage(
      chatId,
      `⚠️ Максимум **${ALERT_LIMIT}** алертов.\n\nУдали старые через /list`,
      mainKeyboard()
    );
    return;
  }

  const alert = {
    id: `a-${Date.now()}`,
    address: pending.address,
    symbol: pending.symbol,
    name: pending.name,
    source,
    kind: pending.kind,
    threshold: pending.threshold,
    basePriceUsd: pending.basePriceUsd || null,
    createdAt: new Date().toISOString(),
    active: true,
    lastPriceUsd: pending.basePriceUsd || null,
    triggeredAt: null
  };

  alerts.push(alert);
  state.users[userId].awaitingInput = null;
  saveState();

  await sendMessage(
    chatId,
    `✅ **Алерт создан**\n\n${formatAlertLine(alert)}\n\nПроверяю цены каждую минуту.`,
    mainKeyboard()
  );
}

async function sendPrice(chatId, query) {
  try {
    const resolved = await resolveAsset(query);
    if (!resolved) {
      await sendMessage(chatId, "Jetton не найден.");
      return;
    }
    if (resolved.multiple?.length) {
      await sendMessage(chatId, "Уточни токен:", {
        inline_keyboard: resolved.multiple.map((asset) => [
          { text: `${asset.symbol} · ${asset.name}`, callback_data: `pick:${asset.address}` }
        ])
      });
      return;
    }
    const prices = await getJettonPrices(resolved.address);
    await sendMessage(chatId, formatPricesMessage(prices), mainKeyboard());
  } catch (error) {
    await sendMessage(chatId, `Ошибка: ${error.message}`);
  }
}

function beginAddAlert(userId) {
  ensureUser(userId);
  state.users[userId].awaitingInput = { type: "alert_token" };
  saveState();
}

function getAlerts(userId) {
  return state.users[userId]?.alerts || [];
}

function removeAlert(userId, alertId) {
  const user = state.users[userId];
  user.alerts = (user.alerts || []).filter((alert) => alert.id !== alertId);
  saveState();
}

function ensureUser(userId) {
  if (!state.users[userId]) {
    state.users[userId] = { alerts: [], awaitingInput: null };
  }
  if (!state.users[userId].alerts) state.users[userId].alerts = [];
}

function alertsText(userId) {
  const alerts = getAlerts(userId);
  if (!alerts.length) {
    return "📭 Алертов пока нет.\n\nНажми **➕ Алерт** или `/add`";
  }
  return [
    `🔔 **Твои алерты** (${alerts.length}/${ALERT_LIMIT})`,
    "",
    ...alerts.map((alert, index) => `${index + 1}. ${formatAlertLine(alert)}`)
  ].join("\n");
}

function formatAlertLine(alert) {
  const sourceLabel = { avg: "STON+DeDust", ston: "STON", dedust: "DeDust" }[alert.source] || alert.source;
  const kindLabel = {
    above: `выше ${formatPriceUsd(alert.threshold)}`,
    below: `ниже ${formatPriceUsd(alert.threshold)}`,
    rise_pct: `рост ≥ ${alert.threshold}%`,
    drop_pct: `падение ≥ ${alert.threshold}%`
  }[alert.kind] || alert.kind;

  const pricePart = alert.lastPriceUsd ? ` · сейчас ${formatPriceUsd(alert.lastPriceUsd)}` : "";
  return `**${alert.symbol}** · ${kindLabel} · ${sourceLabel}${pricePart}`;
}

function alertsKeyboard(userId) {
  const alerts = getAlerts(userId);
  const rows = alerts.map((alert) => [
    { text: `🗑 ${alert.symbol} · ${alert.kind}`, callback_data: `del:${alert.id}` }
  ]);
  rows.push([{ text: "➕ Новый алерт", callback_data: "menu:add" }]);
  return { inline_keyboard: rows };
}

function mainKeyboard() {
  return {
    keyboard: [
      [{ text: "💎 Цена" }, { text: "➕ Алерт" }],
      [{ text: "📋 Мои алерты" }, { text: "❓ Помощь" }]
    ],
    resize_keyboard: true
  };
}

function welcomeText() {
  return [
    `💎 **Price Tons** · @${BOT_USERNAME}`,
    "",
    "Цены jetton'ов на **STON.fi** и **DeDust** + алерты.",
    "",
    "• `/price NOT` — текущая цена",
    "• `/add` — новый алерт",
    "• `/list` — мои алерты",
    "",
    `Полностью **бесплатно**. До **${ALERT_LIMIT}** алертов на аккаунт.`
  ].join("\n");
}

function helpText() {
  return [
    "❓ **Помощь**",
    "",
    "**Команды**",
    "`/price NOT` — цена на STON.fi и DeDust",
    "`/price EQ...` — по адресу jetton",
    "`/add` — создать алерт",
    "`/list` — список алертов",
    "`/delete` — удалить алерт",
    "`/cancel` — отменить ввод",
    "",
    "**Типы алертов**",
    "📈 цена выше USD",
    "📉 цена ниже USD",
    "🚀 рост на N% от цены при создании",
    "💥 падение на N% от цены при создании",
    "",
    "Источник: средняя, STON.fi или DeDust.",
    "",
    "⚠️ Не финсовет. DEX-цены могут отличаться от CEX.",
    "",
    `Бот: @${BOT_USERNAME} · всё бесплатно.`
  ].join("\n");
}

function startAlertLoop() {
  setInterval(() => {
    checkAllAlerts().catch((error) => console.error("Alert loop:", error.message));
  }, CHECK_INTERVAL_MS);
  checkAllAlerts().catch((error) => console.error("Alert loop:", error.message));
}

async function checkAllAlerts() {
  for (const [userId, user] of Object.entries(state.users)) {
    const activeAlerts = (user.alerts || []).filter((alert) => alert.active && !alert.triggeredAt);
    for (const alert of activeAlerts) {
      try {
        await checkAlert(userId, alert);
      } catch (error) {
        console.error(`Alert ${alert.id}:`, error.message);
      }
    }
  }
}

async function checkAlert(userId, alert) {
  const prices = await getJettonPrices(alert.address);
  const current = pickPriceUsd(prices, alert.source);
  if (!current) return;

  alert.lastPriceUsd = current;
  saveState();

  const base = alert.basePriceUsd || current;
  if (!alert.basePriceUsd) {
    alert.basePriceUsd = current;
    saveState();
  }

  let triggered = false;
  let message = "";

  if (alert.kind === "above" && current >= alert.threshold) {
    triggered = true;
    message = `📈 **${alert.symbol}** выше **${formatPriceUsd(alert.threshold)}**\n\nСейчас: **${formatPriceUsd(current)}** (${sourceName(alert.source)})`;
  } else if (alert.kind === "below" && current <= alert.threshold) {
    triggered = true;
    message = `📉 **${alert.symbol}** ниже **${formatPriceUsd(alert.threshold)}**\n\nСейчас: **${formatPriceUsd(current)}** (${sourceName(alert.source)})`;
  } else if (alert.kind === "rise_pct") {
    const change = ((current - base) / base) * 100;
    if (change >= alert.threshold) {
      triggered = true;
      message = `🚀 **${alert.symbol}** вырос на **${change.toFixed(2)}%**\n\nБыло: ${formatPriceUsd(base)} → сейчас: **${formatPriceUsd(current)}**`;
    }
  } else if (alert.kind === "drop_pct") {
    const change = ((base - current) / base) * 100;
    if (change >= alert.threshold) {
      triggered = true;
      message = `💥 **${alert.symbol}** упал на **${change.toFixed(2)}%**\n\nБыло: ${formatPriceUsd(base)} → сейчас: **${formatPriceUsd(current)}**`;
    }
  }

  if (!triggered) return;

  alert.triggeredAt = new Date().toISOString();
  alert.active = false;
  saveState();

  await sendMessage(Number(userId), `${message}\n\n🔕 Алерт сработал и отключён. Создай новый через /add`);
}

function sourceName(source) {
  return { avg: "средняя", ston: "STON.fi", dedust: "DeDust" }[source] || source;
}

function startHealthServer() {
  http
    .createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("price-tons-bot ok");
    })
    .listen(PORT, () => {
      console.log(`Health server on :${PORT}`);
    });
}

async function sendMessage(chatId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true
  };
  if (replyMarkup) payload.reply_markup = replyMarkup;

  if (SELF_TEST) {
    console.log(`[to ${chatId}]`, text);
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
  if (!data.ok) throw new Error(data.description || `Telegram ${method} failed`);
  return data;
}

function loadState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(STATE_PATH)) {
      return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    }
  } catch (error) {
    console.error("State load error:", error.message);
  }
  return { users: {} };
}

function saveState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSelfTest() {
  console.log("Running self-test...\n");

  const not = await resolveAsset("NOT");
  console.log("Resolve NOT:", not?.symbol || not?.multiple?.[0]?.symbol);

  const prices = await getJettonPrices(not.address || not.multiple?.[0]?.address || "EQAvlWFDxGF2lXm67y4yzC17wYKD9A0guwPkMs1gOsM__NOT");
  console.log("\n" + formatPricesMessage(prices));

  ensureUser("test");
  state.users.test.alerts = [{
    id: "demo",
    symbol: prices.symbol,
    address: prices.address,
    source: "avg",
    kind: "below",
    threshold: 999,
    basePriceUsd: prices.avgUsd,
    lastPriceUsd: prices.avgUsd,
    active: true
  }];
  console.log("\n" + alertsText("test"));
  console.log("\nSelf-test OK");
}

module.exports = { runSelfTest };
