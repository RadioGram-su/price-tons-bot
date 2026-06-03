const { pickPriceUsd, formatPriceUsd, formatCompactUsd, getJettonPrices } = require("./prices");
const { recordPrice, getMarketStats, getHourlyChangePct, formatChangePct, dayKey, pctChange } = require("./history");
const { sparklineFromSamples } = require("./sparkline");
const { t } = require("./i18n");
const {
  VOLUME_SPIKE_PCT,
  WHALE_MIN_TON,
  TOKENS,
  PUMP_SCAM_PCT,
  DEFAULT_TIMEZONE_OFFSET,
  DIGEST_MIN_DAY_CHANGE_PCT,
  SPREAD_WARN_PCT
} = require("./config");
const { TON_ADDRESS } = require("./pools");
const { toneForAlert } = require("./tones");
const { assessRisk } = require("./risk");
const { randomTip } = require("./knowledge");
const { actionKeyboard } = require("./links");

const STON_API = "https://api.ston.fi/v1";

function sourceName(source) {
  return { avg: "средняя", ston: "STON.fi", dedust: "DeDust", tonco: "Tonco" }[source] || source;
}

function kindLabel(alert) {
  const map = {
    above: `выше ${formatPriceUsd(alert.threshold)}`,
    below: `ниже ${formatPriceUsd(alert.threshold)}`,
    rise_pct: `рост ≥ ${alert.threshold}%`,
    drop_pct: `падение ≥ ${alert.threshold}%`,
    swing_pct: `резко ± ${alert.threshold}%`,
    volume_spike: `объём +${alert.threshold}%`,
    liquidity_below: `ликвид. < ${alert.threshold} TON`,
    new_pool: "новый пул",
    whale: `кит ≥ ${alert.threshold} TON`,
    pump: `памп ≥ ${alert.threshold}%/ч`,
    spread_dex: `спред DEX ≥ ${alert.threshold}%`
  };
  return map[alert.kind] || alert.kind;
}

function canFireAgain(alert, timezoneOffset = DEFAULT_TIMEZONE_OFFSET) {
  const mode = alert.repeat || "once";
  if (mode === "always") return true;
  if (mode === "daily") {
    const today = dayKey(new Date(), timezoneOffset);
    return alert.lastTriggeredDay !== today;
  }
  return !alert.triggeredAt;
}

function markTriggered(alert, timezoneOffset = DEFAULT_TIMEZONE_OFFSET) {
  alert.triggeredAt = new Date().toISOString();
  alert.lastTriggeredDay = dayKey(new Date(), timezoneOffset);
  if ((alert.repeat || "once") === "once") alert.active = false;
  else if (alert.repeat === "always") {
    alert.basePriceUsd = alert.lastPriceUsd || alert.basePriceUsd;
    alert.baseVolume = alert.lastVolume;
    alert.baseLiquidityTon = alert.lastLiquidityTon;
    if (alert.kind === "spread_dex") alert.baseSpread = alert.lastSpread;
  }
}

function enrichAlertMessage(base, alert, mood, changePct) {
  const tone = toneForAlert(alert.kind === "swing_pct" ? (changePct >= 0 ? "swing_up" : "swing_down") : alert.kind, {
    pct: changePct != null ? `${changePct >= 0 ? "+" : ""}${changePct.toFixed(0)}` : ""
  });
  const tip = randomTip();
  const lines = [base, "", `🎭 _${tone}_`];
  if (tip) lines.push("", tip);
  return lines.join("\n");
}

function buildAlertResult(message, alert, mood, changePct) {
  return {
    text: enrichAlertMessage(message, alert, mood, changePct),
    mood,
    address: alert.address,
    symbol: alert.symbol,
    keyboard: actionKeyboard(alert.address, alert.symbol)
  };
}

async function evaluateAlert(alert, prices, state, timezoneOffset = DEFAULT_TIMEZONE_OFFSET) {
  const current = pickPriceUsd(prices, alert.source);
  if (!current && !["volume_spike", "liquidity_below", "new_pool", "whale", "pump", "spread_dex"].includes(alert.kind)) {
    return null;
  }

  alert.lastPriceUsd = current;
  alert.lastSpread = prices.spread;
  if (prices.market) {
    alert.lastVolume = prices.market.volumeUsd24h;
    alert.lastLiquidityTon = prices.market.reserveTon || prices.dedust?.liquidityTon;
  }

  const base = alert.basePriceUsd || current;
  if (!alert.basePriceUsd && current) alert.basePriceUsd = current;
  if (alert.kind === "spread_dex" && alert.baseSpread == null && prices.spread != null) {
    alert.baseSpread = prices.spread;
  }

  let triggered = false;
  let message = "";
  let mood = "stable";
  let changePct = null;

  if (alert.kind === "above" && current >= alert.threshold) {
    triggered = true;
    mood = "rise";
    message = `📈 **${alert.symbol}** выше **${formatPriceUsd(alert.threshold)}**\n\nСейчас: **${formatPriceUsd(current)}** (${sourceName(alert.source)})`;
  } else if (alert.kind === "below" && current <= alert.threshold) {
    triggered = true;
    mood = "drop";
    message = `📉 **${alert.symbol}** ниже **${formatPriceUsd(alert.threshold)}**\n\nСейчас: **${formatPriceUsd(current)}** (${sourceName(alert.source)})`;
  } else if (alert.kind === "rise_pct") {
    changePct = pctChange(current, base);
    if (changePct != null && changePct >= alert.threshold) {
      triggered = true;
      mood = "rise";
      message = `🚀 **${alert.symbol}** +**${changePct.toFixed(2)}%**\n\n${formatPriceUsd(base)} → **${formatPriceUsd(current)}**`;
    }
  } else if (alert.kind === "drop_pct") {
    changePct = pctChange(current, base);
    const drop = changePct != null && changePct < 0 ? Math.abs(changePct) : 0;
    if (drop >= alert.threshold) {
      triggered = true;
      mood = "drop";
      changePct = -drop;
      message = `💥 **${alert.symbol}** −**${drop.toFixed(2)}%**\n\n${formatPriceUsd(base)} → **${formatPriceUsd(current)}**`;
    }
  } else if (alert.kind === "swing_pct") {
    changePct = pctChange(current, base);
    const change = Math.abs(changePct || 0);
    if (Number.isFinite(alert.threshold) && change >= alert.threshold) {
      triggered = true;
      mood = changePct >= 0 ? "rise" : "drop";
      const arrow = changePct >= 0 ? "📈" : "📉";
      message = `${arrow} **${alert.symbol}** ±**${change.toFixed(2)}%**\n\n${formatPriceUsd(base)} → **${formatPriceUsd(current)}**`;
    }
  } else if (alert.kind === "pump") {
    const hourly = getHourlyChangePct(state, alert.address, current);
    changePct = hourly;
    if (hourly != null && hourly >= (alert.threshold || 100)) {
      triggered = true;
      mood = hourly >= PUMP_SCAM_PCT ? "pump" : "rise";
      const risk = assessRisk(prices);
      message = [
        `🕵️ **Памп ${alert.symbol}** +**${hourly.toFixed(0)}%** за ~час`,
        "",
        hourly >= PUMP_SCAM_PCT
          ? "⚠️ **Высокая вероятность скама / разгрузки**"
          : "⚠️ Резкий рост — не FOMO без проверки",
        "",
        `${formatPriceUsd(current)} · риск **${risk.score}/100** (${risk.label})`
      ].join("\n");
    }
  } else if (alert.kind === "spread_dex") {
    const spread = prices.spread;
    if (spread != null && spread >= alert.threshold) {
      triggered = true;
      mood = "warning";
      message = [
        `⚠️ **${alert.symbol}** спред DEX **${spread.toFixed(1)}%**`,
        "",
        `Порог: **${alert.threshold}%** · возможен арбитраж или тонкая ликвидность`,
        prices.bestBuy ? `🛒 Дешевле: **${prices.bestBuy.dex}**` : ""
      ]
        .filter(Boolean)
        .join("\n");
    }
  } else if (alert.kind === "volume_spike") {
    const vol = prices.market?.volumeUsd24h;
    const baseVol = alert.baseVolume || vol;
    if (!alert.baseVolume && vol) alert.baseVolume = vol;
    if (vol && baseVol && vol >= baseVol * (1 + alert.threshold / 100)) {
      triggered = true;
      mood = "rise";
      message = `📊 **${alert.symbol}** объём вырос\n\n${formatCompactUsd(baseVol)} → **${formatCompactUsd(vol)}**`;
    }
  } else if (alert.kind === "liquidity_below") {
    const liqTon = prices.dedust?.liquidityTon || prices.market?.reserveTon || 0;
    if (liqTon > 0 && liqTon < alert.threshold) {
      triggered = true;
      mood = "warning";
      message = `💧 **${alert.symbol}** ликвидность ниже **${alert.threshold} TON**\n\nСейчас ~**${liqTon.toFixed(1)} TON**`;
    }
  } else if (alert.kind === "new_pool") {
    if (state.newPools?.includes(alert.address)) {
      triggered = true;
      mood = "rise";
      message = `🆕 **${alert.symbol}** — новый пул на STON.fi!`;
      state.newPools = state.newPools.filter((a) => a !== alert.address);
    }
  } else if (alert.kind === "whale") {
    const whale = state.whales?.[alert.address];
    if (whale && whale.ton >= alert.threshold) {
      triggered = true;
      mood = "warning";
      message = `🐋 **Кит ${alert.symbol}** ~**${whale.ton.toFixed(0)} TON**\n\n${whale.hint || "Крупное движение на DEX"}`;
      delete state.whales[alert.address];
    }
  }

  if (!triggered) return null;
  if (!canFireAgain(alert, timezoneOffset)) return null;
  markTriggered(alert, timezoneOffset);
  return buildAlertResult(message, alert, mood, changePct);
}

function detectAutoPump(state, address, prices, timezoneOffset = DEFAULT_TIMEZONE_OFFSET) {
  const current = pickPriceUsd(prices, "avg");
  if (!current) return null;
  const hourly = getHourlyChangePct(state, address, current);
  if (hourly == null || hourly < PUMP_SCAM_PCT) return null;

  if (!state.pumpAlerts) state.pumpAlerts = {};
  const day = dayKey(new Date(), timezoneOffset);
  const key = `${address}:${day}`;
  if (state.pumpAlerts[key]) return null;
  state.pumpAlerts[key] = true;

  const risk = assessRisk(prices);
  const symbol = prices.symbol || "?";
  return {
    text: [
      `🕵️ **Внимание! ${symbol}** +**${hourly.toFixed(0)}%** за ~час`,
      "",
      "⚠️ **Высокая вероятность скама / pump & dump**",
      `${risk.emoji} Риск: **${risk.score}/100** (${risk.label})`,
      "",
      `🎭 _${toneForAlert("pump", { pct: hourly.toFixed(0) })}_`,
      "",
      randomTip() || "💡 Проверь контракт перед FOMO."
    ].join("\n"),
    mood: "pump",
    address,
    symbol,
    keyboard: actionKeyboard(address, symbol)
  };
}

/** Сигнал «кит» по резкому движению цены между тиками мониторинга */
function recordWhaleSignals(state, address, prices) {
  const current = pickPriceUsd(prices, "avg");
  const samples = state.market?.[address]?.samples || [];
  if (!current || samples.length < 2) return;

  const prev = samples[samples.length - 2];
  const move = Math.abs(pctChange(current, prev.p) || 0);
  const vol = prices.market?.volumeUsd24h || 0;
  if (move < 3 || vol < 2000) return;

  const tonUsd = prices.tonUsd || 5;
  const estTon = Math.max((vol * 0.001) / tonUsd, WHALE_MIN_TON * 0.2);
  if (!state.whales) state.whales = {};
  state.whales[address] = {
    ton: estTon,
    hint: `Скачок ~${move.toFixed(1)}% между проверками · объём 24ч ${formatCompactUsd(vol)}`
  };
}

function digestHasMovement(state, watchlist, timezoneOffset) {
  for (const item of watchlist) {
    try {
      const samples = state.market?.[item.address]?.samples || [];
      const current = samples[samples.length - 1]?.p;
      if (!current) return true;
      const stats = getMarketStats(state, item.address, current, timezoneOffset);
      if (Math.abs(stats.dayChangePct || 0) >= DIGEST_MIN_DAY_CHANGE_PCT) return true;
    } catch {
      return true;
    }
  }
  return false;
}

function formatDigestTokenBlock(item, prices, state, timezoneOffset, lang = "ru", assetMeta = null) {
  const current = pickPriceUsd(prices, item.source || "avg");
  const stats = getMarketStats(state, item.address, current, timezoneOffset);
  const spark = sparklineFromSamples(state.market?.[item.address]?.samples || [], 12);
  const risk = assessRisk(prices, assetMeta);
  const lines = [
    `💎 **${item.symbol}** · ${formatPriceUsd(current)}`,
    `${risk.emoji} Риск **${risk.score}/100** · ${risk.label}`,
    `📊 День: ${formatChangePct(stats.dayChangePct)} · 🔺 ${formatPriceUsd(stats.dayHigh)} · 🔻 ${formatPriceUsd(stats.dayLow)}`,
    `📅 Неделя: ${formatChangePct(stats.weekChangePct)}`
  ];
  if (prices.market?.volumeUsd24h) lines.push(t(lang, "vol24", { value: formatCompactUsd(prices.market.volumeUsd24h) }));
  if (prices.market?.liquidityUsd) lines.push(t(lang, "liq", { value: formatCompactUsd(prices.market.liquidityUsd) }));
  if (prices.bestBuy) lines.push(t(lang, "best_buy", { dex: prices.bestBuy.dex }));
  if (prices.spread != null && prices.spread >= SPREAD_WARN_PCT) {
    lines.push(t(lang, "spread_warn", { pct: prices.spread.toFixed(1) }));
  }
  lines.push(t(lang, "spark_7d", { chart: spark }));
  return lines.join("\n");
}

async function getTopMovers(state, symbols, timezoneOffset = DEFAULT_TIMEZONE_OFFSET) {
  const rows = [];
  for (const sym of symbols) {
    try {
      const { resolveAsset } = require("./assets");
      const asset = await resolveAsset(sym);
      if (!asset?.address) continue;
      const prices = await getJettonPrices(asset.address);
      const current = pickPriceUsd(prices, "avg");
      if (current) recordPrice(state, asset.address, current);
      const stats = getMarketStats(state, asset.address, current, timezoneOffset);
      rows.push({
        symbol: asset.symbol,
        address: asset.address,
        change: stats.dayChangePct ?? 0,
        price: current,
        prices
      });
    } catch {
      // skip
    }
  }
  rows.sort((a, b) => (b.change ?? 0) - (a.change ?? 0));
  return rows;
}

async function scanNewPools(state, trackedItems = []) {
  if (!state.knownPools) state.knownPools = {};
  if (!state.newPools) state.newPools = [];

  const items =
    trackedItems.length > 0
      ? trackedItems
      : (TOKENS.presets || []).map((p) => ({ address: p.address, symbol: p.symbol }));

  const seenAssets = new Set();
  for (const item of items) {
    if (!item?.address || seenAssets.has(item.address)) continue;
    seenAssets.add(item.address);
    try {
      const response = await fetch(
        `${STON_API}/pools/by_market/${encodeURIComponent(item.address)}/${encodeURIComponent(TON_ADDRESS)}`
      );
      if (!response.ok) continue;
      const data = await response.json();
      for (const pool of data.pool_list || []) {
        const key = pool.address;
        if (!state.knownPools[key]) {
          state.knownPools[key] = { asset: item.address, symbol: item.symbol || "?", seenAt: Date.now() };
          if (Date.now() - (state.bootAt || 0) > 120_000 && !state.newPools.includes(item.address)) {
            state.newPools.push(item.address);
          }
        }
      }
    } catch {
      // skip
    }
  }
}

module.exports = {
  evaluateAlert,
  detectAutoPump,
  recordWhaleSignals,
  digestHasMovement,
  kindLabel,
  formatDigestTokenBlock,
  getTopMovers,
  scanNewPools,
  sourceName,
  markTriggered,
  canFireAgain
};
