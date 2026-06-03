const STR = {
  ru: {
    welcome_title: "Price Tons",
    free: "Полностью **бесплатно**",
    help: "Помощь",
    spread_warn: "⚠️ **Спред DEX** ~{pct}% — возможна низкая ликвидность или арбитраж",
    best_buy: "🛒 Дешевле на **{dex}**",
    repeat_once: "Один раз",
    repeat_daily: "Раз в день",
    repeat_always: "Снова и снова",
    alert_fired: "Алерт сработал",
    digest_morning: "Утренний дайджест",
    digest_evening: "Вечерний дайджест",
    weekly: "Итоги недели",
    new_pools: "Новые пулы на STON",
    top_movers: "Топ движения за 24ч",
    onboarding: "Быстрый старт — добавить в дайджест?",
    referral_bonus: "🎁 +{n} слота в дайджест и +{a} алерт за друга",
    since_last_visit: "📌 С прошлого визита",
    quiet_hours: "🌙 Тихие часы {start}:00–{end}:00",
    digest_skipped: "_Дайджест пропущен — день тихий (<{pct}%)_",
    queued_alerts: "📬 **{n}** уведомлений за ночь",
    api_down: "⚠️ API {name} недоступен",
    cex_hint: "🏦 CEX (CoinGecko): ~{price} · *ориентир, не для торговли*",
    fdv: "📦 FDV ≈ {value}",
    vol24: "📈 Объём 24ч ≈ {value}",
    liq: "💧 Ликвидность ≈ {value}",
    spark_7d: "7д: {chart}"
  },
  en: {
    welcome_title: "Price Tons",
    free: "Completely **free**",
    help: "Help",
    spread_warn: "⚠️ **DEX spread** ~{pct}% — low liquidity or arb",
    best_buy: "🛒 Cheaper on **{dex}**",
    repeat_once: "Once",
    repeat_daily: "Once per day",
    repeat_always: "Keep watching",
    alert_fired: "Alert triggered",
    digest_morning: "Morning digest",
    digest_evening: "Evening digest",
    weekly: "Weekly summary",
    new_pools: "New STON pools",
    top_movers: "Top 24h movers",
    onboarding: "Quick start — add to digest?",
    referral_bonus: "🎁 +{n} digest slots & +{a} alert per friend",
    since_last_visit: "📌 Since your last visit",
    quiet_hours: "🌙 Quiet hours {start}:00–{end}:00",
    digest_skipped: "_Digest skipped — flat day (<{pct}%)_",
    queued_alerts: "📬 **{n}** overnight alerts",
    api_down: "⚠️ API {name} unavailable",
    cex_hint: "🏦 CEX (CoinGecko): ~{price} · *reference only*",
    fdv: "📦 FDV ≈ {value}",
    vol24: "📈 Vol 24h ≈ {value}",
    liq: "💧 Liquidity ≈ {value}",
    spark_7d: "7d: {chart}"
  }
};

function t(lang, key, vars = {}) {
  const pack = STR[lang] || STR.ru;
  let text = pack[key] || STR.ru[key] || key;
  for (const [k, v] of Object.entries(vars)) {
    text = text.replaceAll(`{${k}}`, String(v));
  }
  return text;
}

module.exports = { t, STR };
