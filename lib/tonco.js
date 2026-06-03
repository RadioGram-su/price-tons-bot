const { TONCO_GRAPHQL } = require("./config");

let poolsCache = null;
let poolsLoadedAt = 0;
const POOLS_TTL = 5 * 60_000;

async function toncoFetch(query) {
  const response = await fetch(TONCO_GRAPHQL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
  if (!response.ok) throw new Error(`Tonco ${response.status}`);
  const data = await response.json();
  if (data.errors?.length) throw new Error(data.errors[0].message);
  return data.data;
}

async function ensureToncoPools(force = false) {
  if (!force && poolsCache && Date.now() - poolsLoadedAt < POOLS_TTL) return poolsCache;
  const data = await toncoFetch(`{
    pools {
      address liquidity priceSqrt
      jetton0 { address symbol decimals }
      jetton1 { address symbol decimals }
    }
  }`);
  poolsCache = data.pools || [];
  poolsLoadedAt = Date.now();
  return poolsCache;
}

function priceFromSqrt(priceSqrt, dec0, dec1, token0IsTon) {
  const sqrt = Number(priceSqrt) / 2 ** 96;
  if (!sqrt || !Number.isFinite(sqrt)) return null;
  let ratio = sqrt * sqrt;
  ratio *= 10 ** (dec0 - dec1);
  if (!ratio) return null;
  const priceTon = token0IsTon ? 1 / ratio : ratio;
  return priceTon > 0 && priceTon < 500 && Number.isFinite(priceTon) ? priceTon : null;
}

async function getToncoPrice(jettonAddress, symbol, tonUsd) {
  const pools = await ensureToncoPools();
  const sym = String(symbol || "").toUpperCase();
  let best = null;

  for (const pool of pools) {
    const j0 = pool.jetton0;
    const j1 = pool.jetton1;
    const isTon0 = j0?.symbol === "TON" || j0?.symbol === "Toncoin";
    const isTon1 = j1?.symbol === "TON" || j1?.symbol === "Toncoin";
    if (!isTon0 && !isTon1) continue;

    const jetton = isTon0 ? j1 : j0;
    const matchAddr = poolMatchesAddress(jetton?.address, jettonAddress);
    const matchSym = sym && jetton?.symbol?.toUpperCase() === sym;
    if (!matchAddr && !matchSym) continue;

    const priceTon = priceFromSqrt(
      pool.priceSqrt,
      Number(j0.decimals || 9),
      Number(j1.decimals || 9),
      isTon0
    );
    if (!priceTon) continue;
    const liq = Number(pool.liquidity || 0);
    if (!best || liq > best.liquidity) {
      best = { priceTon, liquidity: liq, poolAddress: pool.address };
    }
  }

  if (!best) return null;
  return {
    dex: "tonco",
    priceTon: best.priceTon,
    priceUsd: tonUsd ? best.priceTon * tonUsd : null,
    liquidity: best.liquidity,
    poolAddress: best.poolAddress
  };
}

function poolMatchesAddress(toncoAddr, eqAddr) {
  if (!toncoAddr || !eqAddr) return false;
  const a = String(toncoAddr).replace(/^0:/, "").toLowerCase();
  const b = String(eqAddr).replace(/[^A-Za-z0-9_-]/g, "").toLowerCase();
  return b.includes(a.slice(0, 8)) || a.includes(b.slice(0, 8));
}

module.exports = { getToncoPrice, ensureToncoPools };
