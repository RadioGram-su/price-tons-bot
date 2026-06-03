const { getStonAssetByAddress, formatAsset, parseUsd, TON_ADDRESS } = require("./assets");
const { fetchOnce } = require("./price-queue");
const { getToncoPrice } = require("./tonco");
const { getCexPriceUsd } = require("./coingecko");
const { getStonPoolMarket } = require("./pools");
const { SPREAD_WARN_PCT } = require("./config");
const { assessRisk, formatRiskBlock } = require("./risk");
const { actionKeyboard, dexLinksBlock } = require("./links");
const { escapeMd } = require("./markdown");

const DEDUST_API = "https://api.dedust.io/v2";
const POOLS_TTL_MS = 5 * 60 * 1000;

let poolsCache = null;
let poolsLoadedAt = 0;
let jettonPoolIndex = null;
let tonUsdPrice = null;
let tonUsdLoadedAt = 0;

async function dedustFetch(pathname) {
  const response = await fetch(`${DEDUST_API}${pathname}`);
  if (!response.ok) throw new Error(`DeDust API ${response.status}`);
  return response.json();
}

async function getTonUsdPrice(force = false) {
  if (!force && tonUsdPrice && Date.now() - tonUsdLoadedAt < 60_000) return tonUsdPrice;
  const asset = await getStonAssetByAddress(TON_ADDRESS);
  tonUsdPrice = parseUsd(asset?.dex_usd_price || asset?.dex_price_usd) || tonUsdPrice || 0;
  tonUsdLoadedAt = Date.now();
  return tonUsdPrice;
}

async function ensureDedustPools(force = false) {
  if (!force && poolsCache && Date.now() - poolsLoadedAt < POOLS_TTL_MS) return poolsCache;
  poolsCache = await dedustFetch("/pools");
  poolsLoadedAt = Date.now();
  jettonPoolIndex = buildJettonPoolIndex(poolsCache);
  return poolsCache;
}

function buildJettonPoolIndex(pools) {
  const index = new Map();
  for (const pool of pools) {
    if (!pool?.assets || pool.assets.length !== 2) continue;
    const nativeIdx = pool.assets.findIndex((a) => a.type === "native");
    const jettonIdx = pool.assets.findIndex((a) => a.type === "jetton" && a.address);
    if (nativeIdx === -1 || jettonIdx === -1) continue;
    const jettonAddress = pool.assets[jettonIdx].address;
    const tonReserve = Number(pool.reserves?.[nativeIdx] || 0);
    const current = index.get(jettonAddress);
    if (!current || tonReserve > current.tonReserve) {
      index.set(jettonAddress, { pool, nativeIdx, jettonIdx, tonReserve });
    }
  }
  return index;
}

function priceTonFromPool(entry) {
  const { pool, nativeIdx, jettonIdx } = entry;
  const nativeDecimals = pool.assets[nativeIdx]?.metadata?.decimals ?? 9;
  const jettonDecimals = pool.assets[jettonIdx]?.metadata?.decimals ?? 9;
  const nativeReserve = Number(pool.reserves?.[nativeIdx] || 0) / 10 ** nativeDecimals;
  const jettonReserve = Number(pool.reserves?.[jettonIdx] || 0) / 10 ** jettonDecimals;
  if (!nativeReserve || !jettonReserve) return null;
  if (pool.lastPrice != null && Number(pool.lastPrice) > 0) return Number(pool.lastPrice);
  return nativeReserve / jettonReserve;
}

async function getDedustPrice(jettonAddress) {
  await ensureDedustPools();
  const entry = jettonPoolIndex?.get(jettonAddress);
  if (!entry) return null;
  const priceTon = priceTonFromPool(entry);
  if (!priceTon) return null;
  const tonUsd = await getTonUsdPrice();
  const nativeIdx = entry.nativeIdx;
  const tonReserve = Number(entry.pool.reserves?.[nativeIdx] || 0) / 1e9;
  return {
    dex: "dedust",
    priceTon,
    priceUsd: tonUsd ? priceTon * tonUsd : null,
    poolAddress: entry.pool.address,
    liquidityTon: tonReserve
  };
}

async function getStonPrice(jettonAddress) {
  const asset = await getStonAssetByAddress(jettonAddress);
  if (!asset) return null;
  const formatted = formatAsset(asset);
  return {
    dex: "ston",
    priceUsd: formatted.stonPriceUsd,
    priceTon: null,
    symbol: formatted.symbol,
    name: formatted.name,
    totalSupply: asset.total_supply || null,
    decimals: asset.decimals
  };
}

async function fetchJettonPricesRaw(jettonAddress) {
  const [ston, dedust, tonUsd, tonco, cex, market] = await Promise.all([
    getStonPrice(jettonAddress),
    getDedustPrice(jettonAddress),
    getTonUsdPrice(),
    getToncoPrice(jettonAddress, null, null).catch(() => null),
    getCexPriceUsd(jettonAddress).catch(() => null),
    getStonPoolMarket(jettonAddress).catch(() => null)
  ]);

  if (ston?.priceUsd && tonUsd && !ston.priceTon) ston.priceTon = ston.priceUsd / tonUsd;

  let toncoResolved = tonco;
  if (!toncoResolved?.priceUsd && ston?.symbol) {
    toncoResolved = await getToncoPrice(jettonAddress, ston.symbol, tonUsd).catch(() => null);
  }

  if (toncoResolved?.priceUsd && ston?.priceUsd) {
    const ratio = toncoResolved.priceUsd / ston.priceUsd;
    if (ratio > 2.5 || ratio < 0.4) toncoResolved = null;
  }

  const usdValues = [ston?.priceUsd, dedust?.priceUsd, toncoResolved?.priceUsd].filter((v) => v > 0);
  const avgUsd = usdValues.length ? usdValues.reduce((a, b) => a + b, 0) / usdValues.length : null;

  const spread = calcSpreadPct(ston?.priceUsd, dedust?.priceUsd, toncoResolved?.priceUsd);
  const bestBuy = pickBestBuy(ston, dedust, toncoResolved);

  let fdv = null;
  if (ston?.totalSupply && ston?.decimals != null && avgUsd) {
    const supply = Number(ston.totalSupply) / 10 ** ston.decimals;
    if (supply > 0) fdv = supply * avgUsd;
  }

  return {
    address: jettonAddress,
    symbol: ston?.symbol || "?",
    name: ston?.name || "?",
    tonUsd,
    ston,
    dedust,
    tonco: toncoResolved,
    cex,
    avgUsd,
    spread,
    bestBuy,
    market,
    fdv,
    fetchedAt: Date.now()
  };
}

async function getJettonPrices(jettonAddress) {
  return fetchOnce(jettonAddress, fetchJettonPricesRaw);
}

function calcSpreadPct(...prices) {
  const vals = prices.filter((p) => Number.isFinite(p) && p > 0);
  if (vals.length < 2) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return ((max - min) / min) * 100;
}

function pickBestBuy(ston, dedust, tonco) {
  const list = [
    { dex: "STON.fi", price: ston?.priceUsd },
    { dex: "DeDust", price: dedust?.priceUsd },
    { dex: "Tonco", price: tonco?.priceUsd }
  ].filter((x) => x.price > 0);
  if (!list.length) return null;
  list.sort((a, b) => a.price - b.price);
  return list[0];
}

function pickPriceUsd(prices, source = "avg") {
  if (source === "ston") return prices.ston?.priceUsd ?? null;
  if (source === "dedust") return prices.dedust?.priceUsd ?? null;
  if (source === "tonco") return prices.tonco?.priceUsd ?? null;
  return prices.avgUsd ?? prices.ston?.priceUsd ?? prices.dedust?.priceUsd ?? prices.tonco?.priceUsd ?? null;
}

function formatPriceUsd(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1) return `$${value.toFixed(4)}`;
  if (value >= 0.01) return `$${value.toFixed(5)}`;
  if (value >= 0.0001) return `$${value.toFixed(6)}`;
  if (value >= 1e-8) {
    const s = value.toFixed(8).replace(/\.?0+$/, "");
    return `$${s}`;
  }
  return `$${value.toExponential(2)}`;
}

function formatPriceTon(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1) return `${value.toFixed(4)} TON`;
  if (value >= 0.0001) return `${value.toFixed(6)} TON`;
  return `${value.toExponential(3)} TON`;
}

function formatCompactUsd(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return formatPriceUsd(value);
}

function formatPricesMessage(prices, { lang = "ru", spark = null, spreadWarnPct = SPREAD_WARN_PCT, assetMeta = null } = {}) {
  const { t } = require("./i18n");
  const risk = assessRisk(prices, assetMeta);
  const lines = [
    `💎 **${escapeMd(prices.symbol)}** · ${escapeMd(prices.name)}`,
    `📍 \`${prices.address.slice(0, 8)}…${prices.address.slice(-6)}\``,
    "",
    formatRiskBlock(risk, lang),
    ""
  ];

  lines.push(...dexLinksBlock(prices));

  if (prices.avgUsd) lines.push("", `📊 **Средняя:** ${formatPriceUsd(prices.avgUsd)}`);

  if (prices.spread != null && prices.spread >= spreadWarnPct) {
    lines.push(t(lang, "spread_warn", { pct: prices.spread.toFixed(1) }));
  }

  if (prices.bestBuy) lines.push(t(lang, "best_buy", { dex: prices.bestBuy.dex }));

  if (prices.market?.liquidityUsd) lines.push(t(lang, "liq", { value: formatCompactUsd(prices.market.liquidityUsd) }));
  if (prices.market?.volumeUsd24h) lines.push(t(lang, "vol24", { value: formatCompactUsd(prices.market.volumeUsd24h) }));
  if (prices.fdv) lines.push(t(lang, "fdv", { value: formatCompactUsd(prices.fdv) }));
  if (prices.cex) lines.push(t(lang, "cex_hint", { price: formatPriceUsd(prices.cex) }));

  if (spark) lines.push(t(lang, "spark_7d", { chart: spark }));

  if (prices.tonUsd) lines.push(`💠 TON ≈ ${formatPriceUsd(prices.tonUsd)}`);

  return lines.join("\n");
}

function priceKeyboard(address, prices = null) {
  const { RADIO_GRAM_URL } = require("./config");
  const symbol = prices?.symbol || null;
  const dex = actionKeyboard(address, symbol, {
    poolAddress: prices?.market?.poolAddress,
    dedustPoolAddress: prices?.dedust?.poolAddress
  });
  return {
    inline_keyboard: [
      [
        { text: "🔄 Обновить", callback_data: `refresh:${address}` },
        { text: "🔔 Алерт", callback_data: `quickalert:${address}` }
      ],
      [
        { text: "📬 В дайджест", callback_data: `quickwatch:${address}` },
        { text: "📤 Поделиться", switch_inline_query: `${address}` }
      ],
      ...dex.inline_keyboard,
      [
        { text: "📚 Гайды", callback_data: "guide:menu" },
        { text: "🎧 Radio Gram", url: RADIO_GRAM_URL }
      ]
    ]
  };
}

module.exports = {
  getJettonPrices,
  fetchJettonPricesRaw,
  pickPriceUsd,
  formatPriceUsd,
  formatPriceTon,
  formatCompactUsd,
  formatPricesMessage,
  priceKeyboard,
  getTonUsdPrice,
  calcSpreadPct
};
