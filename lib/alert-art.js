const fs = require("fs");
const path = require("path");

const ASSETS_DIR = path.join(__dirname, "..", "assets", "alerts");

const MOODS = {
  rise: { file: "rise.png", title: "НА ЛУНУ?", sub: "FOMO дышит в затылок", accent: "#45de8e", glow: "#1a4d32" },
  drop: { file: "drop.png", title: "АЙ!", sub: "Ловить дно больно", accent: "#ff6b6b", glow: "#4d1a1a" },
  stable: { file: "stable.png", title: "СПОКОЙНО", sub: "Флэт — тоже стратегия", accent: "#7c9cff", glow: "#1a2a4d" },
  pump: { file: "pump.png", title: "ПАМП?!", sub: "Скам или не скам?", accent: "#ffb347", glow: "#4d3a1a" },
  warning: { file: "pump.png", title: "ОПАСНО", sub: "Проверь контракт", accent: "#ff4757", glow: "#4d1010" }
};

function alertImagePath(mood) {
  const meta = MOODS[mood] || MOODS.stable;
  const filePath = path.join(ASSETS_DIR, meta.file);
  return fs.existsSync(filePath) ? filePath : null;
}

function buildAlertSvg(mood, symbol = "TOKEN", pct = "") {
  const meta = MOODS[mood] || MOODS.stable;
  const pctText = pct ? `${pct}` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="400" viewBox="0 0 800 400">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1228"/>
      <stop offset="100%" stop-color="${meta.glow}"/>
    </linearGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="800" height="400" fill="url(#bg)" rx="24"/>
  <text x="40" y="55" fill="#8892b0" font-family="Arial,sans-serif" font-size="22">Price Tons · Radio Gram</text>
  <text x="40" y="140" fill="${meta.accent}" font-family="Arial,sans-serif" font-size="52" font-weight="bold" filter="url(#glow)">${meta.title}</text>
  <text x="40" y="200" fill="#ffffff" font-family="Arial,sans-serif" font-size="36" font-weight="bold">${symbol}${pctText ? ` ${pctText}` : ""}</text>
  <text x="40" y="250" fill="#ccd6f6" font-family="Arial,sans-serif" font-size="24">${meta.sub}</text>
  <polyline points="40,320 120,300 200,310 280,260 360,280 440,220 520,240 600,180 680,200 760,160" fill="none" stroke="${meta.accent}" stroke-width="3" opacity="0.7"/>
</svg>`;
}

function alertImageBuffer(mood, symbol, pct) {
  const filePath = alertImagePath(mood);
  if (filePath) return { buffer: fs.readFileSync(filePath), filename: path.basename(filePath), mime: "image/png" };
  const svg = buildAlertSvg(mood, symbol, pct);
  return { buffer: Buffer.from(svg), filename: `${mood}-alert.svg`, mime: "image/svg+xml" };
}

module.exports = { alertImagePath, alertImageBuffer, MOODS };
