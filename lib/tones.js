const RISE = [
  "Ты снова покупаешь на хаях? 😏 Может, пауза?",
  "Ракета летит — но это TON, тут и падение рядом 🚀",
  "FOMO дышит в затылок. Дыши глубже.",
  "+{pct}%? Красиво. Но кто продал тебе этот рост?"
];

const DROP = [
  "−{pct}%… Больно? Welcome to memecoins 💀",
  "Ловить дно руками — больно. Перчатки есть?",
  "Падает не только цена — падает надежда на «100x за день»",
  "Дип? Или начало дипа? Никто не знает 😅"
];

const STABLE = [
  "Стабильно как Swiss… ну почти 🧘",
  "Флэт — тоже эмоция. Скучно, зато не больно.",
  "Цена стоит. Нервы тоже — держись.",
  "Sideways — время подумать, а не FOMO."
];

const PUMP = [
  "🚨 +{pct}% за час?! Памп или скам — монета не объясняет.",
  "Внимание! Так растут только перед тем, как больно.",
  "200% за час — это не «я гений», это «я мишень» 🎯",
  "Кто-то уже выходит на тебя. Проверь контракт."
];

const RISK = [
  "Риск {score}/100 — не brag, а предупреждение.",
  "Красный уровень риска. DYOR или bye.",
  "Опасность не в цене — в ликвидности и команде."
];

function pick(list, vars = {}) {
  let text = list[Math.floor(Math.random() * list.length)];
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

function toneForAlert(kind, vars = {}) {
  if (kind === "pump" || kind === "pump_warn") return pick(PUMP, vars);
  if (kind === "rise_pct" || kind === "above" || kind === "swing_up") return pick(RISE, vars);
  if (kind === "drop_pct" || kind === "below" || kind === "swing_down") return pick(DROP, vars);
  if (kind === "stable") return pick(STABLE, vars);
  if (kind === "risk") return pick(RISK, vars);
  return pick(STABLE, vars);
}

function moodFromKind(kind, changePct = 0) {
  if (kind === "pump" || kind === "pump_warn") return "pump";
  if (kind === "rise_pct" || kind === "above") return "rise";
  if (kind === "drop_pct" || kind === "below") return "drop";
  if (kind === "swing_pct") return changePct >= 0 ? "rise" : "drop";
  if (Math.abs(changePct) < 3) return "stable";
  return changePct > 0 ? "rise" : "drop";
}

module.exports = { toneForAlert, moodFromKind };
