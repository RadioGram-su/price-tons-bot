const fs = require("fs");
const path = require("path");

const STON_API = "https://api.ston.fi/v1";
const TON_ADDRESS = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
const CACHE_PATH = path.join(__dirname, "..", "data", "assets-cache.json");
const CACHE_TTL_MS = Number(process.env.ASSETS_CACHE_TTL_MS || 6 * 60 * 60 * 1000);

const { TOKENS } = require("./config");

let symbolIndex = null;
let cacheLoadedAt = 0;

function normalizeAddress(value) {
  return String(value || "").trim();
}

function isTonAddress(value) {
  const text = normalizeAddress(value);
  return /^EQ[A-Za-z0-9_-]{46,}$/.test(text) || /^UQ[A-Za-z0-9_-]{46,}$/.test(text);
}

async function stonFetch(pathname, options = {}) {
  const response = await fetch(`${STON_API}${pathname}`, options);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`STON API ${response.status}: ${body.slice(0, 120)}`);
  }
  return response.json();
}

async function getStonAssetByAddress(address) {
  const data = await stonFetch(`/assets/${encodeURIComponent(address)}`);
  return data.asset || null;
}

async function searchStonAssets(query, limit = 10) {
  const data = await stonFetch(`/assets?search_string=${encodeURIComponent(query)}&limit=${limit}`);
  return data.asset_list || [];
}

async function ensureSymbolIndex() {
  if (symbolIndex && Date.now() - cacheLoadedAt < CACHE_TTL_MS) return symbolIndex;

  if (fs.existsSync(CACHE_PATH)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"));
      if (cached.updatedAt && Date.now() - cached.updatedAt < CACHE_TTL_MS && cached.items?.length) {
        symbolIndex = buildIndex(cached.items);
        cacheLoadedAt = cached.updatedAt;
        mergePresets(symbolIndex);
        return symbolIndex;
      }
    } catch {
      // rebuild
    }
  }

  const data = await stonFetch("/assets?limit=5000");
  const items = data.asset_list || [];
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify({ updatedAt: Date.now(), items }), "utf8");
  symbolIndex = buildIndex(items);
  cacheLoadedAt = Date.now();
  mergePresets(symbolIndex);
  return symbolIndex;
}

function mergePresets(index) {
  for (const preset of TOKENS.presets || []) {
    if (!preset.address) continue;
    index.byAddress.set(preset.address, {
      contract_address: preset.address,
      symbol: preset.symbol,
      display_name: preset.name,
      popularity_index: 1e15
    });
    const sym = preset.symbol.toUpperCase();
    if (!index.bySymbol.has(sym)) index.bySymbol.set(sym, []);
    if (!index.bySymbol.get(sym).some((a) => a.contract_address === preset.address)) {
      index.bySymbol.get(sym).unshift({
        contract_address: preset.address,
        symbol: preset.symbol,
        display_name: preset.name,
        popularity_index: 1e15
      });
    }
  }
}

function buildIndex(items) {
  const bySymbol = new Map();
  const byAddress = new Map();
  for (const asset of items) {
    if (!asset?.contract_address) continue;
    byAddress.set(asset.contract_address, asset);
    const symbol = String(asset.symbol || "").trim().toUpperCase();
    if (!symbol) continue;
    if (!bySymbol.has(symbol)) bySymbol.set(symbol, []);
    bySymbol.get(symbol).push(asset);
  }
  for (const list of bySymbol.values()) {
    list.sort((a, b) => Number(b.popularity_index || 0) - Number(a.popularity_index || 0));
  }
  return { bySymbol, byAddress, tonAddress: TON_ADDRESS };
}

async function resolveAsset(query) {
  const text = normalizeAddress(query);
  if (!text) return null;

  const preset = (TOKENS.presets || []).find(
    (p) => p.symbol.toUpperCase() === text.toUpperCase() || p.address === text
  );
  if (preset && !text.startsWith("EQ")) {
    const asset = await getStonAssetByAddress(preset.address).catch(() => null);
    return formatAsset(asset || { contract_address: preset.address, symbol: preset.symbol, display_name: preset.name });
  }

  if (isTonAddress(text)) {
    const asset = await getStonAssetByAddress(text);
    return asset ? formatAsset(asset) : null;
  }

  const index = await ensureSymbolIndex();
  const upper = text.toUpperCase();
  const exact = index.bySymbol.get(upper) || [];

  if (exact.length === 1) return formatAsset(exact[0]);
  if (exact.length > 1) return { multiple: exact.slice(0, 8).map(formatAsset) };

  const remote = await searchStonAssets(text, 8).catch(() => []);
  if (remote.length === 1) return formatAsset(remote[0]);
  if (remote.length > 1) return { multiple: remote.slice(0, 8).map(formatAsset) };

  const partial = [];
  for (const [symbol, assets] of index.bySymbol.entries()) {
    if (symbol.includes(upper)) partial.push(...assets.slice(0, 1));
  }
  partial.sort((a, b) => Number(b.popularity_index || 0) - Number(a.popularity_index || 0));
  if (partial.length) return { multiple: partial.slice(0, 8).map(formatAsset) };

  return null;
}

async function resolveMany(queries) {
  const results = [];
  for (const q of queries) {
    const r = await resolveAsset(q.trim());
    if (r?.address) results.push(r);
    else if (r?.multiple?.[0]) results.push(r.multiple[0]);
  }
  return results;
}

function formatAsset(asset) {
  return {
    address: asset.contract_address,
    symbol: asset.symbol || "?",
    name: asset.display_name || asset.symbol || "Jetton",
    decimals: asset.decimals ?? 9,
    image: asset.image_url || null,
    stonPriceUsd: parseUsd(asset.dex_usd_price || asset.dex_price_usd)
  };
}

function parseUsd(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function presetsKeyboard(prefix = "preset") {
  const featured = (TOKENS.presets || []).filter((p) => p.featured);
  const rows = [];
  for (let i = 0; i < featured.length; i += 3) {
    rows.push(
      featured.slice(i, i + 3).map((p) => ({
        text: p.symbol,
        callback_data: `${prefix}:${p.address}`
      }))
    );
  }
  return { inline_keyboard: rows };
}

module.exports = {
  TON_ADDRESS,
  isTonAddress,
  resolveAsset,
  resolveMany,
  getStonAssetByAddress,
  formatAsset,
  parseUsd,
  presetsKeyboard,
  ensureSymbolIndex
};
