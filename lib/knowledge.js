const fs = require("fs");
const path = require("path");

const CONFIG_DIR = process.env.BOT_CONFIG_DIR || path.join(__dirname, "..", "config");
const KB_PATH = path.join(CONFIG_DIR, "knowledge.json");

const DEFAULT_KB = {
  guides: [
    {
      id: "memecoins",
      emoji: "🎭",
      title: "Как не слить на мем-коинах",
      sections: [
        { heading: "Ликвидность", text: "Если < $20K — выйти сложно. Смотри рейтинг риска в боте." },
        { heading: "Памп", text: "+100–200% за час — часто развод. Не FOMO на хаях." },
        { heading: "Контракт", text: "Кнопка TONScan / GeckoTerminal — holders, deployer." }
      ],
      footer: "Price Tons — не финсовет. DYOR."
    }
  ],
  tips: [
    "💡 Ты снова на хаях? 😏 Сделай паузу.",
    "💡 Проверь контракт перед покупкой.",
    "💡 +200% за час — не гений, а мишень."
  ]
};

let cache = null;

function loadKnowledge() {
  if (cache) return cache;
  try {
    if (fs.existsSync(KB_PATH)) {
      cache = JSON.parse(fs.readFileSync(KB_PATH, "utf8"));
      return cache;
    }
  } catch (e) {
    console.warn("knowledge.json:", e.message);
  }
  cache = DEFAULT_KB;
  return cache;
}

function listGuides() {
  return loadKnowledge().guides || [];
}

function getGuide(id) {
  return listGuides().find((g) => g.id === id) || null;
}

function guidesMenuKeyboard() {
  const rows = listGuides().map((g) => [
    { text: `${g.emoji} ${g.title}`, callback_data: `guide:${g.id}` }
  ]);
  rows.push([{ text: "← Назад", callback_data: "menu:help" }]);
  return { inline_keyboard: rows };
}

function formatGuide(guide) {
  return [
    `${guide.emoji} **${guide.title}**`,
    "",
    ...(guide.sections || []).map((s) => `**${s.heading}**\n${s.text}`),
    "",
    guide.footer ? `_${guide.footer}_` : null
  ].filter(Boolean).join("\n\n");
}

function randomTip() {
  const tips = loadKnowledge().tips || DEFAULT_KB.tips;
  return tips[Math.floor(Math.random() * tips.length)] || null;
}

module.exports = { listGuides, getGuide, guidesMenuKeyboard, formatGuide, randomTip };
