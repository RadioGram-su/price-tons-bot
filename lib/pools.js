const STON_API = "https://api.ston.fi/v1";
const TON_ADDRESS = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";

const poolCache = new Map();
const POOL_TTL = 3 * 60_000;

async function stonFetch(pathname) {
  const response = await fetch(`${STON_API}${pathname}`);
  if (!response.ok) throw new Error(`STON ${response.status}`);
  return response.json();
}

async function getStonPoolMarket(jettonAddress) {
  const cached = poolCache.get(jettonAddress);
  if (cached && Date.now() - cached.t < POOL_TTL) return cached.v;

  try {
    const data = await stonFetch(
      `/pools/by_market/${encodeURIComponent(jettonAddress)}/${encodeURIComponent(TON_ADDRESS)}`
    );
    const pool = data.pool_list?.[0];
    if (!pool) return null;

    const result = {
      liquidityUsd: Number(pool.lp_total_supply_usd) || null,
      reserveTon: Number(pool.reserve1 || pool.reserve0) / 1e9,
      poolAddress: pool.address,
      volumeUsd24h: null
    };

    try {
      const stats = await stonFetch(`/stats/pool?pool_address=${encodeURIComponent(pool.address)}&period=24h`);
      result.volumeUsd24h = Number(stats?.stats?.volume_usd || stats?.volume_usd || 0) || null;
    } catch {
      // stats optional
    }

    poolCache.set(jettonAddress, { t: Date.now(), v: result });
    return result;
  } catch {
    return null;
  }
}

async function fetchRecentAssets(limit = 30) {
  const data = await stonFetch(`/assets?limit=${limit}`);
  return (data.asset_list || []).filter((a) => a.kind === "Jetton");
}

module.exports = { getStonPoolMarket, fetchRecentAssets, TON_ADDRESS };
