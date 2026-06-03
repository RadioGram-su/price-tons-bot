const { TOKENS, GRAM_DNS_URL, RADIO_GRAM_URL } = require("./config");
const { TON_ADDRESS } = require("./pools");

function isGrm(symbol, address) {
  const grmAddr = TOKENS.grm?.address;
  return symbol === "GRM" || (grmAddr && address === grmAddr);
}

function tonviewerUrl(address) {
  return `https://tonviewer.com/${address}`;
}

function tonscanUrl(address) {
  return `https://tonscan.org/jetton/${address}`;
}

function geckoTerminalUrl(address) {
  return `https://www.geckoterminal.com/ton/ton/pools?query=${encodeURIComponent(address)}`;
}

function stonAssetUrl(address) {
  return `https://app.ston.fi/swap?ft=${address}&tt=TON`;
}

function dedustSwapUrl(address) {
  return `https://dedust.io/swap/${TON_ADDRESS}/${address}`;
}

function toncoSwapUrl(address) {
  return `https://app.tonco.io/?inputCurrency=ton&outputCurrency=${address}`;
}

function stonPoolUrl(poolAddress) {
  return `https://app.ston.fi/pools/${poolAddress}`;
}

function dedustPoolUrl(poolAddress) {
  return `https://dedust.io/pools/${poolAddress}`;
}

function gramDnsUrl() {
  return GRAM_DNS_URL;
}

/** Markdown-ссылка для parse_mode Markdown */
function mdLink(label, url) {
  const safe = String(label).replace(/[\[\]]/g, "");
  return `[${safe}](${url})`;
}

function dexLinksBlock(prices) {
  const { formatPriceUsd, formatPriceTon } = require("./prices");
  const addr = prices.address;
  const label = (usd, ton) => {
    if (!Number.isFinite(usd)) return "открыть";
    return ton ? `${formatPriceUsd(usd)} · ${formatPriceTon(ton)}` : formatPriceUsd(usd);
  };
  const lines = [];
  if (prices.ston?.priceUsd) {
    lines.push(`🟢 **STON.fi:** ${mdLink(label(prices.ston.priceUsd, prices.ston.priceTon), stonAssetUrl(addr))}`);
  } else {
    lines.push(`🟢 **STON.fi:** — · ${mdLink("swap", stonAssetUrl(addr))}`);
  }
  if (prices.dedust?.priceUsd) {
    lines.push(`🔵 **DeDust:** ${mdLink(label(prices.dedust.priceUsd, prices.dedust.priceTon), dedustSwapUrl(addr))}`);
  } else {
    lines.push(`🔵 **DeDust:** — · ${mdLink("swap", dedustSwapUrl(addr))}`);
  }
  if (prices.tonco?.priceUsd) {
    lines.push(`🟣 **Tonco:** ${mdLink(label(prices.tonco.priceUsd, prices.tonco.priceTon), toncoSwapUrl(addr))}`);
  }
  if (prices.market?.poolAddress || prices.dedust?.poolAddress) {
    const parts = [];
    if (prices.market?.poolAddress) parts.push(mdLink("пул STON", stonPoolUrl(prices.market.poolAddress)));
    if (prices.dedust?.poolAddress) parts.push(mdLink("пул DeDust", dedustPoolUrl(prices.dedust.poolAddress)));
    lines.push(`💧 **Ликвидность:** ${parts.join(" · ")}`);
  }
  return lines;
}

function actionKeyboard(address, symbol, options = {}) {
  const { poolAddress, dedustPoolAddress } = options;
  const rows = [
    [
      { text: "🟢 STON.fi", url: stonAssetUrl(address) },
      { text: "🔵 DeDust", url: dedustSwapUrl(address) }
    ],
    [
      { text: "🔍 TONScan", url: tonscanUrl(address) },
      { text: "📈 GeckoTerminal", url: geckoTerminalUrl(address) }
    ]
  ];
  const poolRow = [];
  if (poolAddress) poolRow.push({ text: "💧 Пул STON", url: stonPoolUrl(poolAddress) });
  if (dedustPoolAddress) poolRow.push({ text: "💧 Пул DeDust", url: dedustPoolUrl(poolAddress) });
  if (poolRow.length) rows.push(poolRow);
  if (isGrm(symbol, address)) {
    rows.push([
      { text: "📢 Gram Dns", url: gramDnsUrl() },
      { text: "🎧 Radio Gram", url: RADIO_GRAM_URL }
    ]);
  }
  rows.push([{ text: "🔗 Tonviewer", url: tonviewerUrl(address) }]);
  return { inline_keyboard: rows };
}

function scannerKeyboard(address) {
  return actionKeyboard(address, null, {});
}

module.exports = {
  isGrm,
  tonviewerUrl,
  tonscanUrl,
  geckoTerminalUrl,
  stonAssetUrl,
  dedustSwapUrl,
  toncoSwapUrl,
  stonPoolUrl,
  dedustPoolUrl,
  gramDnsUrl,
  mdLink,
  dexLinksBlock,
  actionKeyboard,
  scannerKeyboard
};
