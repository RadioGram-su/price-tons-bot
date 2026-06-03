const priceCache = new Map();
const inflight = new Map();
const TTL_MS = 55_000;

function getCached(address) {
  const hit = priceCache.get(address);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.v;
  return null;
}

function setCached(address, value) {
  priceCache.set(address, { t: Date.now(), v: value });
}

async function fetchOnce(address, fetcher) {
  const cached = getCached(address);
  if (cached) return cached;

  if (inflight.has(address)) return inflight.get(address);

  const promise = fetcher(address)
    .then((value) => {
      if (value) setCached(address, value);
      return value;
    })
    .finally(() => inflight.delete(address));

  inflight.set(address, promise);
  return promise;
}

function invalidate(address) {
  priceCache.delete(address);
  inflight.delete(address);
}

module.exports = { fetchOnce, getCached, setCached, invalidate };
