const LEVELS = {
  safe: { emoji: "🟢", label: "Низкий", bar: "████░░░░░░" },
  low: { emoji: "🟡", label: "Умеренный", bar: "██████░░░░" },
  medium: { emoji: "🟠", label: "Повышенный", bar: "████████░░" },
  danger: { emoji: "🔴", label: "Опасный", bar: "██████████" }
};

function assessRisk(prices, assetMeta = null) {
  let score = 0;
  const factors = [];

  const liq = prices.market?.liquidityUsd || 0;
  const vol = prices.market?.volumeUsd24h || 0;
  const spread = prices.spread || 0;

  if (liq < 5000) {
    score += 35;
    factors.push("ликвидность < $5K");
  } else if (liq < 25000) {
    score += 20;
    factors.push("ликвидность < $25K");
  } else if (liq < 100000) {
    score += 8;
  } else {
    factors.push("ликвидность OK");
  }

  if (spread >= 15) {
    score += 25;
    factors.push(`спред DEX ${spread.toFixed(0)}%`);
  } else if (spread >= 8) {
    score += 15;
    factors.push(`спред ${spread.toFixed(0)}%`);
  } else if (spread >= 5) {
    score += 8;
  }

  if (liq > 0 && vol < liq * 0.05) {
    score += 12;
    factors.push("мало объёма vs ликвидность");
  }

  if (prices.fdv && liq > 0 && prices.fdv / liq > 80) {
    score += 18;
    factors.push("FDV >> ликвидности");
  }

  if (assetMeta?.blacklisted) {
    score += 40;
    factors.push("⚠️ blacklist STON");
  }

  const tags = assetMeta?.tags || [];
  const trusted = tags.some((t) => /essential|default_symbol|verified/i.test(t));
  if (!trusted && !["TON", "USDT", "USDT", "STON"].includes(prices.symbol)) {
    score += 10;
    factors.push("аудит/команда не подтверждены");
  }

  if (!prices.dedust?.priceUsd || !prices.ston?.priceUsd) {
    score += 8;
    factors.push("торгуется на 1 DEX");
  }

  score = Math.min(100, Math.max(0, score));
  const level = score >= 70 ? "danger" : score >= 45 ? "medium" : score >= 25 ? "low" : "safe";
  const meta = LEVELS[level];

  return {
    score,
    level,
    emoji: meta.emoji,
    label: meta.label,
    bar: meta.bar,
    factors: factors.slice(0, 4)
  };
}

function formatRiskBlock(risk, lang = "ru") {
  const tips = {
    danger: "Мем без DYOR = лотерея. Не FOMO.",
    medium: "Можно смотреть, но размер позиции — маленький.",
    low: "Терпимо, всё равно проверь контракт.",
    safe: "Спокойнее обычного, но рынок шутит."
  };
  return [
    `${risk.emoji} **Рейтинг риска:** ${risk.label} · **${risk.score}/100**`,
    `\`${risk.bar}\``,
    `📋 ${risk.factors.join(" · ")}`,
    `💬 _${tips[risk.level]}_`
  ].join("\n");
}

module.exports = { assessRisk, formatRiskBlock, LEVELS };
