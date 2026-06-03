const { COINGECKO_API } = require("./config");

const cache = new Map();
const TTL = 120_000;

async function getCexPriceUsd(jettonAddress) {
  const key = jettonAddress;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.v;

  try {
    const url = `${COINGECKO_API}/simple/token_price/ton?contract_addresses=${encodeURIComponent(jettonAddress)}&vs_currencies=usd`;
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) return null;
    const data = await response.json();
    const price = data[jettonAddress]?.usd ?? data[jettonAddress.toLowerCase()]?.usd;
    if (!price) return null;
    cache.set(key, { t: Date.now(), v: Number(price) });
    return Number(price);
  } catch {
    return null;
  }
}

module.exports = { getCexPriceUsd };
