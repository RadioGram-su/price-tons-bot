function startOfDayMs(date = new Date(), timezoneOffset = 3) {
  const local = new Date(date.getTime() + timezoneOffset * 3600_000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  return Date.UTC(y, m, d) - timezoneOffset * 3600_000;
}

function dayKey(date = new Date(), timezoneOffset = 3) {
  const local = new Date(date.getTime() + timezoneOffset * 3600_000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function recordPrice(state, address, priceUsd) {
  if (!address || !Number.isFinite(priceUsd) || priceUsd <= 0) return;

  if (!state.market) state.market = {};
  const now = Date.now();
  const entry = state.market[address] || { samples: [] };

  const last = entry.samples[entry.samples.length - 1];
  if (last && now - last.t < 30_000 && Math.abs(last.p - priceUsd) / priceUsd < 0.0001) {
    return;
  }

  entry.samples.push({ t: now, p: priceUsd });
  entry.samples = entry.samples.filter((sample) => now - sample.t <= 8 * 86400_000);

  state.market[address] = entry;
}

function getMarketStats(state, address, currentPrice, timezoneOffset = 3) {
  const entry = state.market?.[address];
  const now = Date.now();
  const dayStart = startOfDayMs(new Date(), timezoneOffset);
  const weekAgo = now - 7 * 86400_000;

  const todaySamples = entry?.samples?.filter((sample) => sample.t >= dayStart) || [];
  const weekSamples = entry?.samples?.filter((sample) => sample.t >= weekAgo) || [];

  const pricesToday = todaySamples.map((sample) => sample.p);
  if (Number.isFinite(currentPrice)) pricesToday.push(currentPrice);

  const dayOpen = todaySamples[0]?.p ?? currentPrice ?? null;
  const dayHigh = pricesToday.length ? Math.max(...pricesToday) : currentPrice ?? null;
  const dayLow = pricesToday.length ? Math.min(...pricesToday) : currentPrice ?? null;

  const weekOpen = weekSamples[0]?.p ?? entry?.samples?.[0]?.p ?? currentPrice ?? null;

  const dayChangePct = dayOpen && currentPrice ? pctChange(currentPrice, dayOpen) : null;
  const weekChangePct = weekOpen && currentPrice ? pctChange(currentPrice, weekOpen) : null;

  return {
    dayOpen,
    dayHigh,
    dayLow,
    weekOpen,
    dayChangePct,
    weekChangePct,
    hasDayData: todaySamples.length > 0 || Number.isFinite(currentPrice),
    hasWeekData: weekSamples.length > 1 || (entry?.samples?.length || 0) > 1
  };
}

function pctChange(current, base) {
  if (!base || !Number.isFinite(current)) return null;
  return ((current - base) / base) * 100;
}

function formatChangePct(value) {
  if (!Number.isFinite(value)) return "—";
  if (value > 0) return `+${value.toFixed(2)}%`;
  if (value < 0) return `−${Math.abs(value).toFixed(2)}%`;
  return "0.00%";
}

function getHourlyChangePct(state, address, currentPrice) {
  const samples = state.market?.[address]?.samples || [];
  if (!samples.length || !Number.isFinite(currentPrice)) return null;
  const hourAgo = Date.now() - 3600000;
  const ref = samples.find((s) => s.t >= hourAgo) || samples[0];
  if (!ref?.p) return null;
  return pctChange(currentPrice, ref.p);
}

module.exports = {
  dayKey,
  recordPrice,
  getMarketStats,
  getHourlyChangePct,
  formatChangePct,
  pctChange
};
