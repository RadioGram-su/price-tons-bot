const { getStonAssetByAddress, formatAsset, parseUsd, TON_ADDRESS } = require("./assets");

const DEDUST_API = "https://api.dedust.io/v2";
const POOLS_TTL_MS = Number(process.env.DEDUST_POOLS_TTL_MS || 5 * 60 * 1000);

let poolsCache = null;
let poolsLoadedAt = 0;
let jettonPoolIndex = null;
let tonUsdPrice = null;
let tonUsdLoadedAt = 0;

async function dedustFetch(pathname) {
  const response = await fetch(`${DEDUST_API}${pathname}`);
  if (!response.ok) {
    throw new Error(`DeDust API ${response.status}`);
  }
  return response.json();
}

async function getTonUsdPrice(force = false) {
  if (!force && tonUsdPrice && Date.now() - tonUsdLoadedAt < 60_000) {
    return tonUsdPrice;
  }
  const asset = await getStonAssetByAddress(TON_ADDRESS);
  tonUsdPrice = parseUsd(asset?.dex_usd_price || asset?.dex_price_usd) || tonUsdPrice || 0;
  tonUsdLoadedAt = Date.now();
  return tonUsdPrice;
}

async function ensureDedustPools(force = false) {
  if (!force && poolsCache && Date.now() - poolsLoadedAt < POOLS_TTL_MS) {
    return poolsCache;
  }

  poolsCache = await dedustFetch("/pools");
  poolsLoadedAt = Date.now();
  jettonPoolIndex = buildJettonPoolIndex(poolsCache);
  return poolsCache;
}

function buildJettonPoolIndex(pools) {
  const index = new Map();

  for (const pool of pools) {
    if (!pool?.assets || pool.assets.length !== 2) continue;
    const nativeIdx = pool.assets.findIndex((asset) => asset.type === "native");
    const jettonIdx = pool.assets.findIndex((asset) => asset.type === "jetton" && asset.address);
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

  if (pool.lastPrice != null && Number(pool.lastPrice) > 0) {
    return Number(pool.lastPrice);
  }

  return nativeReserve / jettonReserve;
}

async function getDedustPrice(jettonAddress) {
  await ensureDedustPools();
  const entry = jettonPoolIndex?.get(jettonAddress);
  if (!entry) return null;

  const priceTon = priceTonFromPool(entry);
  if (!priceTon) return null;

  const tonUsd = await getTonUsdPrice();
  return {
    dex: "dedust",
    priceTon,
    priceUsd: tonUsd ? priceTon * tonUsd : null,
    poolAddress: entry.pool.address
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
    name: formatted.name
  };
}

async function getJettonPrices(jettonAddress) {
  const [ston, dedust, tonUsd] = await Promise.all([
    getStonPrice(jettonAddress),
    getDedustPrice(jettonAddress),
    getTonUsdPrice()
  ]);

  if (ston?.priceUsd && tonUsd && !ston.priceTon) {
    ston.priceTon = ston.priceUsd / tonUsd;
  }

  const usdValues = [ston?.priceUsd, dedust?.priceUsd].filter((value) => Number.isFinite(value) && value > 0);
  const avgUsd = usdValues.length
    ? usdValues.reduce((sum, value) => sum + value, 0) / usdValues.length
    : null;

  return {
    address: jettonAddress,
    symbol: ston?.symbol || dedust?.symbol || "?",
    name: ston?.name || "?",
    tonUsd,
    ston,
    dedust,
    avgUsd
  };
}

function pickPriceUsd(prices, source = "avg") {
  if (source === "ston") return prices.ston?.priceUsd ?? null;
  if (source === "dedust") return prices.dedust?.priceUsd ?? null;
  return prices.avgUsd ?? prices.ston?.priceUsd ?? prices.dedust?.priceUsd ?? null;
}

function formatPriceUsd(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1) return `$${value.toFixed(4)}`;
  if (value >= 0.01) return `$${value.toFixed(5)}`;
  if (value >= 0.0001) return `$${value.toFixed(7)}`;
  return `$${value.toExponential(3)}`;
}

function formatPriceTon(value) {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1) return `${value.toFixed(4)} TON`;
  if (value >= 0.0001) return `${value.toFixed(6)} TON`;
  return `${value.toExponential(3)} TON`;
}

function formatPricesMessage(prices) {
  const lines = [
    `💎 **${prices.symbol}** · ${prices.name}`,
    `📍 \`${prices.address.slice(0, 8)}…${prices.address.slice(-6)}\``,
    ""
  ];

  if (prices.ston?.priceUsd) {
    lines.push(`🟢 **STON.fi:** ${formatPriceUsd(prices.ston.priceUsd)}${prices.ston.priceTon ? ` · ${formatPriceTon(prices.ston.priceTon)}` : ""}`);
  } else {
    lines.push("🟢 **STON.fi:** нет данных");
  }

  if (prices.dedust?.priceUsd) {
    lines.push(`🔵 **DeDust:** ${formatPriceUsd(prices.dedust.priceUsd)} · ${formatPriceTon(prices.dedust.priceTon)}`);
  } else {
    lines.push("🔵 **DeDust:** нет пула TON или данных");
  }

  if (prices.avgUsd) {
    lines.push("", `📊 **Средняя:** ${formatPriceUsd(prices.avgUsd)}`);
  }

  if (prices.tonUsd) {
    lines.push(`💠 TON ≈ ${formatPriceUsd(prices.tonUsd)}`);
  }

  return lines.join("\n");
}

module.exports = {
  getJettonPrices,
  pickPriceUsd,
  formatPriceUsd,
  formatPriceTon,
  formatPricesMessage,
  getTonUsdPrice
};
