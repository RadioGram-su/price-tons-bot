const fs = require("fs");
const path = require("path");
const http = require("http");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";
const PORT = Number(process.env.PORT || 8788);
const RADIO_GRAM_URL = process.env.RADIO_GRAM_URL || "https://player.radiogram.su/";
const CHANNEL_URL = process.env.CHANNEL_URL || "https://t.me/gramradiochill";
const SUPPORT_URL = process.env.SUPPORT_URL || "https://pay.cloudtips.ru/p/b5dba7c2";
const SELF_TEST = process.argv.includes("--self-test");

const DEFAULT_REMINDER_SLOTS = ["morning", "midday", "evening"];
const REMINDER_HOURS = {
  morning: Number(process.env.REMINDER_MORNING || 9),
  midday: Number(process.env.REMINDER_MIDDAY || 13),
  afternoon: Number(process.env.REMINDER_AFTERNOON || 17),
  evening: Number(process.env.REMINDER_EVENING || 20)
};

const ROOT_DIR = __dirname;
const DATA_DIR = process.env.BOT_DATA_DIR || process.env.DATA_DIR || path.join(ROOT_DIR, "data");
const CONFIG_DIR = process.env.BOT_CONFIG_DIR || path.join(ROOT_DIR, "config");
const STATE_PATH = process.env.BOT_STATE_PATH || path.join(DATA_DIR, "state.json");
const MOTIVATION = loadConfigJson("motivation.json");
const REPLACEMENTS = loadConfigJson("replacements.json");
const ARTICLES = loadConfigJson("articles.json");
const IMAGES_META = loadConfigJson("images.json");
const SAVINGS_IDEAS = loadConfigJson("savings-ideas.json");
const IMAGES_DIR = path.join(CONFIG_DIR, "images");

const HABIT_PRESETS = {
  smoking: {
    type: "smoking",
    name: "Курение",
    emoji: "🚭",
    dailyAmount: 20,
    unitLabel: "сигарет",
    unitCost: 250,
    moneyPerDay: 250,
    costLabel: "₽/пачка"
  },
  alcohol: {
    type: "alcohol",
    name: "Алкоголь",
    emoji: "🍷",
    dailyAmount: 1,
    unitLabel: "порций",
    unitCost: 500,
    moneyPerDay: 500,
    costLabel: "₽/день"
  },
  masturbation: {
    type: "masturbation",
    name: "Онанизм / порно",
    emoji: "🧠",
    dailyAmount: 1,
    unitLabel: "раз",
    unitCost: 0,
    moneyPerDay: 0,
    costLabel: "₽/день"
  },
  junkfood: {
    type: "junkfood",
    name: "Вредная еда",
    emoji: "🍔",
    dailyAmount: 2,
    unitLabel: "перекусов",
    unitCost: 400,
    moneyPerDay: 400,
    costLabel: "₽/день"
  }
};

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
  startReminderLoop();

  console.log("Habit tracker bot started.");
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
  if (!message || !message.chat) return;

  const chatId = message.chat.id;
  const userId = String(message.from?.id || chatId);
  ensureUser(userId, chatId);

  if (!message.text) {
    await sendMessage(chatId, "Пиши текстом или используй кнопки ниже 👇", mainKeyboard());
    return;
  }

  let text = message.text.trim();
  const keyboardMap = {
    "📊 Прогресс": "/stats",
    "💬 Мотивация": "/motivation",
    "🚨 SOS /urge": "/urge",
    "😔 Сорвался": "/relapse",
    "📚 Статьи": "/articles",
    "➕ Добавить": "/add",
    "🗑 Удалить": "/delete",
    "🎧 Радио & музыка": "/links",
    "⚙️ Настройки": "/settings",
    "❓ Помощь": "/help"
  };
  if (keyboardMap[text]) text = keyboardMap[text];

  if (text.startsWith("/start")) {
    await sendMessage(chatId, startText(userId), mainKeyboard());
    await sendMessage(chatId, linksIntroText(), linksKeyboard());
    return;
  }

  if (text.startsWith("/help")) {
    await sendMessage(chatId, helpText(), mainKeyboard());
    return;
  }

  if (text.startsWith("/stats") || text.startsWith("/progress")) {
    await sendMessage(chatId, statsText(userId), statsKeyboard(userId));
    return;
  }

  if (text.startsWith("/motivation") || text.startsWith("/motiv")) {
    await sendMotivation(chatId, userId, "manual");
    return;
  }

  if (text.startsWith("/urge") || text.startsWith("/helpme") || text.startsWith("/sos")) {
    await sendUrgeHelp(chatId, userId);
    return;
  }

  if (text.startsWith("/add")) {
    await sendMessage(chatId, "Выбери, от чего хочешь отказаться:", addHabitKeyboard());
    return;
  }

  if (text.startsWith("/habits") || text.startsWith("/delete") || text.startsWith("/remove")) {
    const intro = text.startsWith("/delete") || text.startsWith("/remove")
      ? deleteHabitIntroText()
      : habitsText(userId);
    await sendMessage(chatId, intro, habitsKeyboard(userId));
    return;
  }

  if (text.startsWith("/settings")) {
    await sendMessage(chatId, settingsText(userId), settingsKeyboard(userId));
    return;
  }

  if (text.startsWith("/relapse")) {
    await sendMessage(chatId, relapseIntroText(), relapseKeyboard(userId));
    return;
  }

  if (text.startsWith("/articles") || text.startsWith("/article")) {
    await sendMessage(chatId, articlesIntroText(), articlesMenuKeyboard(userId));
    return;
  }

  if (text.startsWith("/links") || text.startsWith("/radio")) {
    await sendMessage(chatId, linksIntroText(), linksKeyboard());
    return;
  }

  if (state.users[userId].awaitingInput) {
    await handleAwaitingInput(userId, chatId, text);
    return;
  }

  await sendMessage(
    chatId,
    "Не понял команду. Нажми кнопку ниже или /help.\n\nЕсли накрыло прямо сейчас — /urge",
    mainKeyboard()
  );
}

async function handleCallback(callback) {
  const data = callback.data || "";
  const chatId = callback.message.chat.id;
  const userId = String(callback.from.id);
  ensureUser(userId, chatId);

  if (data === "menu:links") {
    await answerCallback(callback.id);
    await sendMessage(chatId, linksIntroText(), linksKeyboard());
    return;
  }

  if (data === "menu:main") {
    await answerCallback(callback.id);
    await sendMessage(chatId, startText(userId), mainKeyboard());
    return;
  }

  if (data === "menu:stats") {
    await answerCallback(callback.id);
    await sendMessage(chatId, statsText(userId), statsKeyboard(userId));
    return;
  }

  if (data === "menu:motivation") {
    await answerCallback(callback.id);
    await sendMotivation(chatId, userId, "manual");
    return;
  }

  if (data === "menu:urge") {
    await answerCallback(callback.id);
    await sendUrgeHelp(chatId, userId);
    return;
  }

  if (data === "menu:habits") {
    await answerCallback(callback.id);
    await sendMessage(chatId, habitsText(userId), habitsKeyboard(userId));
    return;
  }

  if (data === "menu:settings") {
    await answerCallback(callback.id);
    await sendMessage(chatId, settingsText(userId), settingsKeyboard(userId));
    return;
  }

  if (data === "menu:relapse") {
    await answerCallback(callback.id);
    await sendMessage(chatId, relapseIntroText(), relapseKeyboard(userId));
    return;
  }

  if (data === "add:menu") {
    await answerCallback(callback.id);
    await sendMessage(chatId, "Выбери, от чего хочешь отказаться:", addHabitKeyboard(userId));
    return;
  }

  if (data.startsWith("add:")) {
    const type = data.split(":")[1];
    await answerCallback(callback.id);
    await beginAddHabit(userId, chatId, type);
    return;
  }

  if (data.startsWith("remove:") && data.split(":").length === 2) {
    const habitId = data.split(":")[1];
    const habit = getHabit(userId, habitId);
    await answerCallback(callback.id);
    if (!habit) {
      await sendMessage(chatId, "Привычка не найдена.", habitsKeyboard(userId));
      return;
    }
    await sendMessage(
      chatId,
      `🗑 **Удалить привычку?**\n\n${habit.emoji} **${habit.name}**\n\nСтатистика и streak по ней **исчезнут**. Это нельзя отменить.`,
      deleteConfirmKeyboard(habitId)
    );
    return;
  }

  if (data.startsWith("remove:confirm:")) {
    const habitId = data.split(":")[2];
    const habit = getHabit(userId, habitId);
    const name = habit ? `${habit.emoji} ${habit.name}` : "Привычка";
    removeHabit(userId, habitId);
    await answerCallback(callback.id, "Удалено");
    await sendMessage(chatId, `✅ ${name} удалена из трекера.`, mainKeyboard());
    return;
  }

  if (data === "article:menu") {
    await answerCallback(callback.id);
    await sendMessage(chatId, articlesIntroText(), articlesMenuKeyboard(userId));
    return;
  }

  if (data.startsWith("article:pick:")) {
    const habitId = data.split(":")[2];
    const habit = getHabit(userId, habitId);
    await answerCallback(callback.id);
    if (!habit) {
      await sendMessage(chatId, "Привычка не найдена.", articlesMenuKeyboard(userId));
      return;
    }
    await sendMessage(chatId, `${habit.emoji} **${habit.name}** — выбери тему:`, articleTopicsKeyboard(habitId));
    return;
  }

  if (data.startsWith("article:") && data.split(":").length === 3) {
    const [, habitId, section] = data.split(":");
    const habit = getHabit(userId, habitId);
    await answerCallback(callback.id);
    if (!habit) {
      await sendMessage(chatId, "Привычка не найдена.", articlesMenuKeyboard(userId));
      return;
    }
    const text = articleText(habit, section, state.users[userId].timezoneOffset);
    await sendMessage(chatId, text, articleTopicsKeyboard(habitId));
    return;
  }

  if (data.startsWith("relapse:") && !data.startsWith("relapse:confirm:")) {
    const habitId = data.split(":")[1];
    const habit = getHabit(userId, habitId);
    await answerCallback(callback.id);
    if (!habit) return;
    await sendMessage(
      chatId,
      `${habit.emoji} **${habit.name}**\n\nСорвался? Счётчик обнулится, новый цикл начнётся **сегодня**.\n\nЭто не провал — это честный перезапуск.`,
      relapseConfirmKeyboard(habitId)
    );
    return;
  }

  if (data.startsWith("relapse:confirm:")) {
    const habitId = data.split(":")[2];
    const habit = getHabit(userId, habitId);
    if (!habit) {
      await answerCallback(callback.id);
      return;
    }
    const prevDays = habitStats(habit, state.users[userId].timezoneOffset).days;
    logRelapse(userId, habitId);
    await answerCallback(callback.id, "Счётчик обнулён");
    await sendMotivationWithImage(
      chatId,
      relapseSupportText(userId, habitId, prevDays),
      habit.type,
      "urge",
      mainKeyboard()
    );
    return;
  }

  if (data.startsWith("toggle_slot:")) {
    const slot = data.split(":")[1];
    toggleReminderSlot(userId, slot);
    await answerCallback(callback.id);
    await sendMessage(chatId, settingsText(userId), settingsKeyboard(userId));
    return;
  }

  if (data === "toggle_reminders") {
    const user = state.users[userId];
    user.reminders.enabled = !user.reminders.enabled;
    saveState();
    await answerCallback(callback.id);
    await sendMessage(chatId, settingsText(userId), settingsKeyboard(userId));
    return;
  }

  if (data === "replace:more") {
    await answerCallback(callback.id);
    await sendReplacement(chatId, userId);
    return;
  }

  if (data.startsWith("set_tz:")) {
    const offset = Number(data.split(":")[1]);
    state.users[userId].timezoneOffset = offset;
    saveState();
    await answerCallback(callback.id, `Часовой пояс: UTC${offset >= 0 ? "+" : ""}${offset}`);
    await sendMessage(chatId, settingsText(userId), settingsKeyboard(userId));
    return;
  }

  await answerCallback(callback.id);
}

async function handleAwaitingInput(userId, chatId, text) {
  const pending = state.users[userId].awaitingInput;
  if (!pending) return;

  if (pending.type === "custom_habit_name") {
    const name = cleanText(text).slice(0, 40);
    if (!name) {
      await sendMessage(chatId, "Напиши название привычки текстом.");
      return;
    }
    state.users[userId].awaitingInput = { type: "custom_daily_amount", name };
    saveState();
    await sendMessage(chatId, `Сколько раз в день обычно? (число, например 5)\nИли напиши 0, если не считаешь.`);
    return;
  }

  if (pending.type === "custom_daily_amount") {
    const dailyAmount = Math.max(0, Number(text.replace(",", ".")) || 0);
    state.users[userId].awaitingInput = { type: "custom_unit_cost", name: pending.name, dailyAmount };
    saveState();
    await sendMessage(chatId, "💰 **Сколько ₽ в день** тратишь на эту привычку?\n(Запомню один раз. Напиши число или 0)");
    return;
  }

  if (pending.type === "custom_unit_cost") {
    const moneyPerDay = Math.max(0, Number(text.replace(",", ".")) || 0);
    addHabit(userId, {
      type: "custom",
      name: pending.name,
      emoji: "🎯",
      dailyAmount: pending.dailyAmount,
      moneyPerDay,
      unitCost: moneyPerDay,
      unitLabel: "раз",
      costLabel: "₽/день"
    });
    state.users[userId].awaitingInput = null;
    saveState();
    const moneyLine = moneyPerDay ? `\n💰 Расход: **${moneyPerDay} ₽/день**` : "";
    await sendMessage(chatId, `✅ Добавлено: **${pending.name}**${moneyLine}\n\n${statsText(userId)}`, mainKeyboard());
    return;
  }

  if (pending.type === "preset_daily_amount") {
    const normalized = text.toLowerCase();
    const parsed = Number(text.replace(",", "."));
    const dailyAmount = normalized === "ок" || normalized === "ok"
      ? pending.defaultAmount
      : Math.max(1, parsed || pending.defaultAmount);
    const preset = HABIT_PRESETS[pending.presetType];
    const defaultMoney = suggestMoneyPerDay(preset, dailyAmount);
    state.users[userId].awaitingInput = {
      type: "preset_money_per_day",
      presetType: pending.presetType,
      dailyAmount,
      defaultMoney
    };
    saveState();
    await sendMessage(
      chatId,
      `${preset.emoji} **${preset.name}**\n\n💰 **Сколько ₽ в день** ты тратишь на это?\n(Запомню один раз.)\n\nПодсказка: ~**${defaultMoney} ₽/день**\nНапиши число или «ок» для подсказки.`
    );
    return;
  }

  if (pending.type === "preset_money_per_day") {
    const normalized = text.toLowerCase();
    const parsed = Number(text.replace(",", "."));
    const moneyPerDay = normalized === "ок" || normalized === "ok"
      ? pending.defaultMoney
      : Math.max(0, parsed || pending.defaultMoney);
    addHabit(userId, {
      ...HABIT_PRESETS[pending.presetType],
      dailyAmount: pending.dailyAmount,
      moneyPerDay,
      unitCost: moneyPerDay
    });
    state.users[userId].awaitingInput = null;
    saveState();
    const preset = HABIT_PRESETS[pending.presetType];
    const habit = getHabitByType(userId, preset.type);
    await sendMessage(
      chatId,
      `✅ **${preset.name}** — старт!\n💰 Расход: **${moneyPerDay} ₽/день**\n\n${statsText(userId)}\n\n${pickMotivation(preset.type, "morning", habit, state.users[userId].timezoneOffset)}`,
      mainKeyboard()
    );
    return;
  }

  state.users[userId].awaitingInput = null;
  saveState();
}

async function beginAddHabit(userId, chatId, type) {
  if (type === "custom") {
    state.users[userId].awaitingInput = { type: "custom_habit_name" };
    saveState();
    await sendMessage(chatId, "Напиши название привычки, от которой отказываешься.\nНапример: сладкое, соцсети, азартные игры.");
    return;
  }

  const preset = HABIT_PRESETS[type];
  if (!preset) {
    await sendMessage(chatId, "Неизвестный тип. Выбери из списка.", addHabitKeyboard(userId));
    return;
  }

  if (getHabitByType(userId, type)) {
    await sendMessage(chatId, `${preset.emoji} ${preset.name} уже добавлено. Смотри /stats`, mainKeyboard());
    return;
  }

  state.users[userId].awaitingInput = {
    type: "preset_daily_amount",
    presetType: type,
    defaultAmount: preset.dailyAmount
  };
  saveState();
  await sendMessage(
    chatId,
    `${preset.emoji} ${preset.name}\n\nСколько ${preset.unitLabel} в день обычно? (по умолчанию ${preset.dailyAmount})\nНапиши число или «ок» для значения по умолчанию.`
  );
}

function addHabit(userId, config) {
  ensureUser(userId);
  const user = state.users[userId];
  const id = config.type === "custom" ? `custom-${Date.now()}` : config.type;
  const nowIso = new Date().toISOString();
  user.habits.push({
    id,
    type: config.type,
    name: config.name,
    emoji: config.emoji || "🎯",
    quitDate: todayKey(user.timezoneOffset),
    quitAt: nowIso,
    dailyAmount: config.dailyAmount || 1,
    moneyPerDay: config.moneyPerDay ?? config.unitCost ?? HABIT_PRESETS[config.type]?.moneyPerDay ?? 0,
    unitCost: config.unitCost ?? config.moneyPerDay ?? HABIT_PRESETS[config.type]?.unitCost ?? 0,
    unitLabel: config.unitLabel || HABIT_PRESETS[config.type]?.unitLabel || "раз",
    relapses: [],
    lastMotivationSlot: {}
  });
  saveState();
}

function removeHabit(userId, habitId) {
  const user = state.users[userId];
  user.habits = user.habits.filter((habit) => habit.id !== habitId);
  saveState();
}

function logRelapse(userId, habitId) {
  const habit = getHabit(userId, habitId);
  if (!habit) return;
  habit.relapses.push({ at: new Date().toISOString() });
  const nowIso = new Date().toISOString();
  habit.quitDate = todayKey(state.users[userId].timezoneOffset);
  habit.quitAt = nowIso;
  saveState();
}

function toggleReminderSlot(userId, slot) {
  const user = state.users[userId];
  const index = user.reminders.slots.indexOf(slot);
  if (index >= 0) user.reminders.slots.splice(index, 1);
  else user.reminders.slots.push(slot);
  user.reminders.slots.sort();
  saveState();
}

async function sendMotivation(chatId, userId, source) {
  const user = state.users[userId];
  if (!user.habits.length) {
    await sendMessage(chatId, "Сначала добавь привычку для отслеживания.", addHabitKeyboard());
    return;
  }

  const habit = pickRandom(user.habits);
  const slot = source === "manual" ? currentSlot(user.timezoneOffset) : source;
  const motivation = pickMotivation(habit.type, slot, habit, user.timezoneOffset);
  const statsBlock = relapseStatLine(habit, user.timezoneOffset);
  const caption = `${habit.emoji} **${habit.name}**\n\n${motivation}\n\n${statsBlock}`;
  await sendMotivationWithImage(chatId, caption, habit.type, slot, mainKeyboard());
}

async function sendUrgeHelp(chatId, userId) {
  const user = state.users[userId];
  const habit = user.habits.length ? pickRandom(user.habits) : null;
  const motivation = habit
    ? pickMotivation(habit.type, "urge", habit, user.timezoneOffset)
    : pickFrom(MOTIVATION.general.urge);
  const replacement = pickReplacement(habit?.type || "general");

  const caption = `🚨 **Сильное желание — это нормально.**\n\n${motivation}\n\n🔄 **Замени привычку на:**\n${replacement}`;
  await sendMotivationWithImage(chatId, caption, habit?.type || "general", "urge", {
    inline_keyboard: [
      [{ text: "🔄 Ещё замена", callback_data: "replace:more" }],
      [{ text: "📊 Мой прогресс", callback_data: "menu:stats" }],
      [{ text: "📚 Статьи", callback_data: "article:menu" }],
      [{ text: "😔 Сорвался", callback_data: "menu:relapse" }]
    ]
  });
}

async function sendReplacement(chatId, userId) {
  const user = state.users[userId];
  const habit = user.habits.length ? pickRandom(user.habits) : null;
  const replacement = pickReplacement(habit?.type || "general");
  await sendMessage(chatId, `🔄 Попробуй вместо этого:\n\n${replacement}`, {
    inline_keyboard: [[{ text: "🔄 Ещё идея", callback_data: "replace:more" }]]
  });
}

function pickMotivation(habitType, slot, habit, timezoneOffset = 3) {
  const pool = [
    ...asArray(MOTIVATION[habitType]?.[slot]),
    ...asArray(MOTIVATION.general[slot]),
    ...asArray(MOTIVATION[habitType]?.urge),
    ...asArray(MOTIVATION.general.urge)
  ].filter(Boolean);

  let message = pickRandom(pool.length ? pool : ["💪 Ты держишься. Это главное."]);
  const stats = habitStats(habit, timezoneOffset);

  message = message
    .replaceAll("{days}", String(stats.days))
    .replaceAll("{savedMoney}", String(stats.savedMoney))
    .replaceAll("{savedUnits}", String(stats.savedUnits))
    .replaceAll("{elapsed}", formatElapsed(stats.elapsed))
    .replaceAll("{savingsIdea}", pickSavingsIdea(stats.savedMoney, habit.type));

  const milestone = MOTIVATION[habitType]?.milestones?.[String(stats.days)];
  if (milestone) message = `${milestone}\n\n${message}`;

  return message;
}

function pickReplacement(habitType) {
  const pool = [
    ...asArray(REPLACEMENTS[habitType]),
    ...asArray(REPLACEMENTS.general)
  ];
  return pickRandom(pool);
}

function statsText(userId) {
  const user = state.users[userId];
  if (!user.habits.length) {
    return "Пока нет отслеживаемых привычек.\n\nДобавь курение, алкоголь или свою — и я буду считать дни и присылать мотивацию.";
  }

  return user.habits
    .map((habit) => {
      const stats = habitStats(habit, user.timezoneOffset);
      return [
        `${habit.emoji} **${habit.name}**`,
        relapseStatLine(habit, user.timezoneOffset),
        `🔥 Текущий streak: **${stats.currentStreak}** ${pluralDays(stats.currentStreak)}`,
        `🏆 Лучший streak: **${stats.bestStreak}** ${pluralDays(stats.bestStreak)}`,
        stats.savedUnits > 0 ? `📉 Не потреблено: ~**${stats.savedUnits}** ${habit.unitLabel}` : null,
        formatSavingsBlock(habit, stats),
        stats.relapseCount > 0 ? `⚠️ Срывов записано: ${stats.relapseCount}` : null,
        `🗓 Старт цикла: ${formatDateTime(habit.quitAt || habit.quitDate)}`
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function habitStats(habit, timezoneOffset = 3) {
  ensureHabitTimestamps(habit, timezoneOffset);
  const elapsed = getElapsed(habit);
  const days = elapsed.days;
  const progressDays = elapsed.progressDays;
  const savedUnits = Math.round(progressDays * (habit.dailyAmount || 0));
  const savedMoney = estimateSavedMoney(habit, progressDays);
  const relapseCount = habit.relapses?.length || 0;
  const currentStreak = days;
  const bestStreak = Math.max(currentStreak, habit.bestStreak || 0);

  if (bestStreak > (habit.bestStreak || 0)) {
    habit.bestStreak = bestStreak;
    saveState();
  }

  return { days, hours: elapsed.hours, minutes: elapsed.minutes, progressDays, savedUnits, savedMoney, relapseCount, currentStreak, bestStreak, elapsed };
}

function ensureHabitTimestamps(habit, timezoneOffset) {
  if (!habit.quitAt && habit.quitDate) {
    habit.quitAt = new Date(`${habit.quitDate}T00:00:00.000Z`).toISOString();
  }
  if (!habit.quitDate && habit.quitAt) {
    habit.quitDate = habit.quitAt.slice(0, 10);
  }
}

function getElapsed(habit) {
  const start = new Date(habit.quitAt || habit.quitDate);
  const ms = Math.max(0, Date.now() - start.getTime());
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const progressDays = ms / 86400000;
  return { ms, days, hours, minutes, progressDays, totalHours: ms / 3600000 };
}

function formatElapsed(elapsed) {
  const parts = [];
  if (elapsed.days > 0) parts.push(`**${elapsed.days}** ${pluralDays(elapsed.days)}`);
  parts.push(`**${elapsed.hours}** ч`);
  parts.push(`**${elapsed.minutes}** мин`);
  return parts.join(" ");
}

function formatDateTime(value) {
  if (!value) return "—";
  if (String(value).includes("T")) {
    const date = new Date(value);
    const dd = String(date.getUTCDate()).padStart(2, "0");
    const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = date.getUTCFullYear();
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const min = String(date.getUTCMinutes()).padStart(2, "0");
    return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
  }
  return formatDate(value);
}

function estimateSavedMoney(habit, progressDays) {
  const perDay = getMoneyPerDay(habit);
  if (!perDay) return 0;
  return Math.round(progressDays * perDay);
}

function getMoneyPerDay(habit) {
  if (habit.moneyPerDay != null && habit.moneyPerDay >= 0) return habit.moneyPerDay;
  if (habit.type === "smoking" && habit.unitCost) {
    return Math.round(((habit.dailyAmount || 20) / 20) * habit.unitCost);
  }
  return habit.unitCost || 0;
}

function suggestMoneyPerDay(preset, dailyAmount) {
  if (preset.type === "smoking" && preset.unitCost) {
    return Math.max(0, Math.round((dailyAmount / 20) * preset.unitCost));
  }
  return preset.moneyPerDay ?? preset.unitCost ?? 0;
}

function pickSavingsIdea(amount, habitType) {
  const tiers = SAVINGS_IDEAS?.by_amount || [];
  const tier = tiers.find((t) => amount >= t.min && amount < t.max) || tiers[tiers.length - 1];
  const typeIdeas = asArray(SAVINGS_IDEAS?.by_type?.[habitType] || SAVINGS_IDEAS?.by_type?.custom);
  const ideas = [...asArray(tier?.ideas), ...typeIdeas];
  return pickRandom(ideas.length ? ideas : ["что-то приятное для себя"]);
}

function formatSavingsBlock(habit, stats) {
  const perDay = getMoneyPerDay(habit);
  if (!perDay) return null;
  const perHour = Math.max(1, Math.round(perDay / 24));
  const idea = pickSavingsIdea(Math.max(stats.savedMoney, perDay), habit.type);
  return [
    `💰 **Сэкономлено:** ~**${stats.savedMoney} ₽** за ${formatElapsed(stats.elapsed)}`,
    `📊 Было **${perDay} ₽/день** · копится ~**${perHour} ₽/час**`,
    `💡 **На это можно:** ${idea}`
  ].join("\n");
}

function habitsText(userId) {
  const user = state.users[userId];
  if (!user.habits.length) return "Список пуст. Добавь первую привычку 👇";
  return [
    "📋 **Твои привычки:**",
    "",
    ...user.habits.map((habit) => {
      const stats = habitStats(habit, user.timezoneOffset);
      return `${habit.emoji} ${habit.name} — ${stats.days} ${pluralDays(stats.days)} ${stats.hours} ч ${stats.minutes} мин`;
    }),
    "",
    "🗑 Чтобы **удалить** — нажми кнопку с корзиной или **🗑 Удалить** в меню."
  ].join("\n");
}

function deleteHabitIntroText() {
  return "🗑 **Удалить привычку**\n\nВыбери, какую убрать из трекера.\nСтатистика по ней будет удалена без восстановления.";
}

function settingsText(userId) {
  const user = state.users[userId];
  const slots = user.reminders.slots.length
    ? user.reminders.slots.map(slotLabel).join(", ")
    : "выключены";
  return [
    "⚙️ **Настройки**",
    `🔔 Напоминания: ${user.reminders.enabled ? "включены" : "выключены"}`,
    `🕐 Слоты: ${slots}`,
    `🌍 Часовой пояс: UTC${user.timezoneOffset >= 0 ? "+" : ""}${user.timezoneOffset}`,
    "",
    "Напоминания приходят 1 раз в выбранный слот, если ещё не отправляли сегодня."
  ].join("\n");
}

function startText(userId) {
  const user = state.users[userId];
  const intro = [
    "💚 **Habit Tracker — твой путь без вредных привычек**",
    "",
    "Я помогаю отказаться от **курения**, **алкоголя** и других привычек:",
    "• считаю дни и streak",
    "• присылаю мотивацию утром, днём и вечером",
    "• помогаю в момент сильного желания (/urge)",
    "• предлагаю **здоровые замены**",
    "• **статьи**: польза, синдромы, как справиться",
    "• сравнение: **лучше X% людей** на твоём этапе",
    "",
    "⚠️ Я не заменяю врача. При тяжёой зависимости — обратись к специалисту."
  ];

  if (user.habits.length) intro.push("", statsText(userId));
  else intro.push("", "Начни с добавления привычки 👇");

  return intro.join("\n");
}

function helpText() {
  return [
    "📖 **Команды**",
    "/start — главное меню",
    "/stats — прогресс и streak",
    "/motivation — мотивация сейчас",
    "/urge — сильное желание, SOS-помощь",
    "/habits — список привычек",
    "/delete — удалить привычку",
    "/relapse — сорвался, обнулить счётчик",
    "/articles — статьи по привычкам",
    "/links — радио, музыка, донат",
    "/settings — напоминания и часовой пояс",
    "/help — эта справка",
    "",
    "Кнопка **SOS** — когда накрывает прямо сейчас."
  ].join("\n");
}

function relapseIntroText() {
  return "😔 **Сорвался?**\n\nВыбери привычку — **обнулю счётчик**, новый streak начнётся с **сегодня**.\n\nЭто не конец. Честность с собой — уже сила.";
}

function relapseSupportText(userId, habitId, prevDays = 0) {
  const habit = getHabit(userId, habitId);
  if (!habit) return "Записал. Дыши. Ты можешь начать снова прямо сейчас.";
  return [
    `${habit.emoji} **${habit.name}** — срыв записан.`,
    prevDays > 0 ? `📉 Streak **${prevDays}** ${pluralDays(prevDays)} обнулён. Новый старт: **сегодня**.` : "🔄 Счётчик обнулён. Новый старт: **сегодня**.",
    "",
    pickMotivation(habit.type, "urge", habit, state.users[userId].timezoneOffset),
    "",
    "💪 Один срыв не стирает весь путь. Ты уже знаешь, что можешь."
  ].join("\n");
}

function articlesIntroText() {
  return "📚 **Статьи по привычкам**\n\nВыбери привычку — расскажу про:\n• пользу отказа\n• экономию\n• синдромы по дням\n• как справляться с тягой";
}

function articleText(habit, section, timezoneOffset) {
  const type = ARTICLES[habit.type] ? habit.type : "custom";
  const block = ARTICLES[type];
  let text = block[section] || block.benefits;
  if (section === "savings") {
    const stats = habitStats(habit, timezoneOffset);
    const savings = formatSavingsBlock(habit, stats);
    if (savings) {
      text += `\n\n${savings}`;
    } else {
      text += `\n\n📊 **Твой streak:** **${stats.days}** ${pluralDays(stats.days)} ${stats.hours} ч ${stats.minutes} мин без срыва.`;
      if (stats.savedUnits > 0) {
        text += `\n📉 Не потреблено: ~**${stats.savedUnits}** ${habit.unitLabel}.`;
      }
    }
  }
  return text;
}

function getSurvivalPercent(habitType, progressDays) {
  const table = ARTICLES.survival_percent[habitType] || ARTICLES.survival_percent.custom;
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (progressDays <= keys[0]) return table[String(keys[0])];
  if (progressDays >= keys[keys.length - 1]) return table[String(keys[keys.length - 1])];

  for (let i = 0; i < keys.length - 1; i += 1) {
    const left = keys[i];
    const right = keys[i + 1];
    if (progressDays >= left && progressDays <= right) {
      const leftVal = table[String(left)];
      const rightVal = table[String(right)];
      const ratio = (progressDays - left) / (right - left);
      return Math.round(leftVal + (rightVal - leftVal) * ratio);
    }
  }
  return table[String(keys[0])];
}

function getRelapsePercent(habitType, progressDays) {
  return clamp(100 - getSurvivalPercent(habitType, progressDays), 1, 99);
}

function relapseStatLine(habit, timezoneOffset) {
  ensureHabitTimestamps(habit, timezoneOffset);
  const elapsed = getElapsed(habit);
  const type = ARTICLES[habit.type] ? habit.type : "custom";

  if (elapsed.ms < 60000) {
    return "🚀 **Старт** — каждая минута без срыва уже победа.";
  }

  const relapse = getRelapsePercent(type, elapsed.progressDays);
  const survive = 100 - relapse;

  return [
    `⏱ **Без срыва:** ${formatElapsed(elapsed)}`,
    `📉 К этому моменту по статистике срываются **~${relapse}%** людей`,
    `🏅 Ты держишься **лучше ~${survive}%** на этом этапе`
  ].join("\n");
}

function linksIntroText() {
  return [
    "🎧 **Музыка для твоих побед и отдыха**",
    "",
    "Включай **Radio Gram** — когда нужен фон, драйв или просто выдохнуть.",
    "",
    "☕ А если бот помогает — можно угостить «безработного разработчика» 😄"
  ].join("\n");
}

function linksKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "📻 Онлайн радио Radio Gram", url: RADIO_GRAM_URL }],
      [{ text: "🎵 Музыка для побед и отдыха", url: CHANNEL_URL }],
      [{ text: "☕ Поддержать разработчика", url: SUPPORT_URL }]
    ]
  };
}

function pickImageName(habitType, slot) {
  const pool = [
    ...asArray(IMAGES_META[habitType]),
    ...asArray(IMAGES_META[slot]),
    ...asArray(IMAGES_META.general)
  ].filter(Boolean);
  return pickRandom(pool.length ? pool : null);
}

function resolveImagePath(fileName) {
  if (!fileName) return null;
  const candidates = [
    path.join(IMAGES_DIR, fileName),
    path.join(ROOT_DIR, "images", fileName),
    path.join(ROOT_DIR, "data", fileName)
  ];
  return candidates.find((filePath) => fs.existsSync(filePath)) || null;
}

async function sendMotivationWithImage(chatId, caption, habitType, slot, replyMarkup) {
  const imageName = pickImageName(habitType, slot);
  const imagePath = resolveImagePath(imageName);
  if (imagePath) return sendPhotoFile(chatId, imagePath, caption, replyMarkup);
  return sendMessage(chatId, caption, replyMarkup);
}

async function sendPhotoFile(chatId, imagePath, caption, replyMarkup) {
  if (SELF_TEST) return sendMessage(chatId, caption, replyMarkup);

  const buffer = fs.readFileSync(imagePath);
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("photo", new Blob([buffer], { type: "image/jpeg" }), path.basename(imagePath));
  form.append("caption", caption.slice(0, 1024));
  form.append("parse_mode", "Markdown");
  if (replyMarkup) form.append("reply_markup", JSON.stringify(replyMarkup));

  const response = await fetch(`${telegramApi}/sendPhoto`, { method: "POST", body: form });
  const data = await response.json();
  if (!data.ok) {
    console.error("sendPhoto failed:", data.description);
    return sendMessage(chatId, caption, replyMarkup);
  }
  return data;
}

function mainKeyboard() {
  return {
    keyboard: [
      [{ text: "📊 Прогресс" }, { text: "💬 Мотивация" }],
      [{ text: "🚨 SOS /urge" }, { text: "😔 Сорвался" }],
      [{ text: "📚 Статьи" }, { text: "➕ Добавить" }],
      [{ text: "🎧 Радио & музыка" }, { text: "🗑 Удалить" }],
      [{ text: "⚙️ Настройки" }, { text: "❓ Помощь" }]
    ],
    resize_keyboard: true
  };
}

function statsKeyboard(userId) {
  return {
    inline_keyboard: [
      [{ text: "💬 Мотивация", callback_data: "menu:motivation" }],
      [{ text: "📚 Статьи", callback_data: "article:menu" }],
      [{ text: "🚨 SOS", callback_data: "menu:urge" }],
      [{ text: "😔 Сорвался", callback_data: "menu:relapse" }],
      [{ text: "🎧 Радио & музыка", callback_data: "menu:links" }],
      [{ text: "➕ Добавить привычку", callback_data: "add:menu" }]
    ]
  };
}

function articlesMenuKeyboard(userId) {
  const user = state.users[userId];
  if (!user.habits.length) {
    return { inline_keyboard: [[{ text: "➕ Добавить привычку", callback_data: "add:menu" }]] };
  }
  const rows = user.habits.map((habit) => [
    { text: `${habit.emoji} ${habit.name}`, callback_data: `article:pick:${habit.id}` }
  ]);
  rows.push([{ text: "← Главное меню", callback_data: "menu:main" }]);
  return { inline_keyboard: rows };
}

function articleTopicsKeyboard(habitId) {
  return {
    inline_keyboard: [
      [{ text: "🌿 Польза отказа", callback_data: `article:${habitId}:benefits` }],
      [{ text: "💰 Экономия", callback_data: `article:${habitId}:savings` }],
      [{ text: "🧠 Синдромы по дням", callback_data: `article:${habitId}:withdrawal` }],
      [{ text: "🛡 Как справиться", callback_data: `article:${habitId}:cravings` }],
      [{ text: "← К привычкам", callback_data: "article:menu" }]
    ]
  };
}

function relapseConfirmKeyboard(habitId) {
  return {
    inline_keyboard: [
      [{ text: "✅ Да, обнулить счётчик", callback_data: `relapse:confirm:${habitId}` }],
      [{ text: "❌ Нет, держусь!", callback_data: "menu:main" }]
    ]
  };
}

function habitsKeyboard(userId) {
  const user = state.users[userId];
  const rows = user.habits.map((habit) => [
    { text: `🗑 ${habit.emoji} ${habit.name}`, callback_data: `remove:${habit.id}` }
  ]);
  rows.push(
    [{ text: "➕ Добавить", callback_data: "add:menu" }],
    [{ text: "← Главное меню", callback_data: "menu:main" }]
  );
  return { inline_keyboard: rows };
}

function deleteConfirmKeyboard(habitId) {
  return {
    inline_keyboard: [
      [{ text: "✅ Да, удалить", callback_data: `remove:confirm:${habitId}` }],
      [{ text: "❌ Отмена", callback_data: "menu:habits" }]
    ]
  };
}

function addHabitKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "🚭 Курение", callback_data: "add:smoking" }],
      [{ text: "🍷 Алкоголь", callback_data: "add:alcohol" }],
      [{ text: "🧠 Онанизм / порно", callback_data: "add:masturbation" }],
      [{ text: "🍔 Вредная еда", callback_data: "add:junkfood" }],
      [{ text: "🎯 Своя привычка", callback_data: "add:custom" }]
    ]
  };
}

function settingsKeyboard(userId) {
  const user = state.users[userId];
  const slots = ["morning", "midday", "afternoon", "evening"];
  const slotRows = slots.map((slot) => [{
    text: `${user.reminders.slots.includes(slot) ? "✅" : "⬜"} ${slotLabel(slot)}`,
    callback_data: `toggle_slot:${slot}`
  }]);

  return {
    inline_keyboard: [
      [{ text: user.reminders.enabled ? "🔔 Выключить напоминания" : "🔕 Включить напоминания", callback_data: "toggle_reminders" }],
      ...slotRows,
      [
        { text: "UTC+2", callback_data: "set_tz:2" },
        { text: "UTC+3", callback_data: "set_tz:3" },
        { text: "UTC+4", callback_data: "set_tz:4" }
      ],
      [{ text: "← Назад", callback_data: "menu:main" }]
    ]
  };
}

function relapseKeyboard(userId) {
  const user = state.users[userId];
  if (!user.habits.length) {
    return { inline_keyboard: [[{ text: "➕ Добавить привычку", callback_data: "add:menu" }]] };
  }
  return {
    inline_keyboard: user.habits.map((habit) => [
      { text: `${habit.emoji} ${habit.name}`, callback_data: `relapse:${habit.id}` }
    ])
  };
}

function startReminderLoop() {
  setInterval(() => {
    tickReminders().catch((error) => console.error("Reminder loop:", error.message));
  }, 60 * 1000);
  tickReminders().catch((error) => console.error("Reminder loop:", error.message));
}

async function tickReminders() {
  for (const [userId, user] of Object.entries(state.users)) {
    if (!user.reminders?.enabled || !user.chatId || !user.habits.length) continue;

    const hour = currentHour(user.timezoneOffset);
    for (const slot of user.reminders.slots || DEFAULT_REMINDER_SLOTS) {
      if (hour !== REMINDER_HOURS[slot]) continue;
      if (user.lastReminderDate?.[slot] === todayKey(user.timezoneOffset)) continue;

      user.lastReminderDate = user.lastReminderDate || {};
      user.lastReminderDate[slot] = todayKey(user.timezoneOffset);
      saveState();

      const habit = pickRandom(user.habits);
      const motivation = pickMotivation(habit.type, slot, habit, user.timezoneOffset);
      const caption = `🔔 ${slotLabel(slot)}\n\n${habit.emoji} ${habit.name}\n\n${motivation}\n\n${relapseStatLine(habit, user.timezoneOffset)}`;
      try {
        await sendMotivationWithImage(user.chatId, caption, habit.type, slot, mainKeyboard());
      } catch (error) {
        console.error(`Reminder failed for ${userId}:`, error.message);
      }
    }
  }
}

function startHealthServer() {
  http
    .createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Habit tracker bot is running.");
    })
    .listen(PORT, () => console.log(`Health server listening on ${PORT}`));
}

async function telegram(method, payload) {
  const response = await fetch(`${telegramApi}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`${method}: ${data.description || response.statusText}`);
  return data;
}

async function sendMessage(chatId, text, replyMarkup) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
    reply_markup: replyMarkup
  });
}

async function answerCallback(callbackQueryId, text) {
  return telegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text: text || "",
    show_alert: Boolean(text)
  });
}

function ensureUser(userId, chatId) {
  if (!state.users[userId]) {
    state.users[userId] = {
      chatId: chatId || null,
      timezoneOffset: 3,
      habits: [],
      reminders: { enabled: true, slots: [...DEFAULT_REMINDER_SLOTS] },
      lastReminderDate: {},
      awaitingInput: null,
      createdAt: new Date().toISOString()
    };
  }
  if (chatId) state.users[userId].chatId = chatId;
}

function getHabit(userId, habitId) {
  return state.users[userId]?.habits.find((habit) => habit.id === habitId);
}

function getHabitByType(userId, type) {
  return state.users[userId]?.habits.find((habit) => habit.type === type);
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { users: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    return { users: parsed.users || {} };
  } catch {
    return { users: {} };
  }
}

function saveState() {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadConfigJson(name) {
  const candidates = [
    path.join(CONFIG_DIR, name),
    path.join(ROOT_DIR, "data", name)
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) return loadJson(filePath);
  }
  throw new Error(`Missing config file: ${name}`);
}

function todayKey(timezoneOffset = 3) {
  const now = new Date(Date.now() + timezoneOffset * 3600000);
  return now.toISOString().slice(0, 10);
}

function daysSince(dateKey, timezoneOffset = 3) {
  if (!dateKey) return 0;
  const start = new Date(`${dateKey}T00:00:00.000Z`);
  const now = new Date(Date.now() + timezoneOffset * 3600000);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const diff = today - start;
  return Math.max(0, Math.floor(diff / 86400000));
}

function currentHour(timezoneOffset = 3) {
  const now = new Date(Date.now() + timezoneOffset * 3600000);
  return now.getUTCHours();
}

function currentSlot(timezoneOffset = 3) {
  const hour = currentHour(timezoneOffset);
  if (hour >= 7 && hour <= 10) return "morning";
  if (hour >= 11 && hour <= 14) return "midday";
  if (hour >= 15 && hour <= 18) return "afternoon";
  return "evening";
}

function slotLabel(slot) {
  return {
    morning: "Утро",
    midday: "День",
    afternoon: "После обеда",
    evening: "Вечер"
  }[slot] || slot;
}

function formatDate(dateKey) {
  const [y, m, d] = dateKey.split("-");
  return `${d}.${m}.${y}`;
}

function pluralDays(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "день";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "дня";
  return "дней";
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function pickFrom(list) {
  return pickRandom(list);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return [value];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSelfTest() {
  ensureUser("test", 1);
  addHabit("test", { ...HABIT_PRESETS.smoking, dailyAmount: 15 });
  const user = state.users.test;
  const habit = user.habits[0];
  console.log("Stats:\n", statsText("test"));
  console.log("\nMotivation morning:\n", pickMotivation("smoking", "morning", habit, 3));
  console.log("\nUrge:\n", pickMotivation("smoking", "urge", habit, 3));
  console.log("\nReplacement:\n", pickReplacement("smoking"));
  console.log("\nPercentile:\n", relapseStatLine(habit, 3));
  console.log("\nArticle:\n", articleText(habit, "benefits", 3).slice(0, 120) + "...");
  console.log("\nSelf-test OK");
}
