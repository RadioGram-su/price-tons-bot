const BARS = "▁▂▃▄▅▆▇█";

function sparklineFromSamples(samples, width = 14) {
  if (!samples?.length) return "—";
  const points = samples.slice(-width).map((s) => s.p);
  if (points.length === 1) return BARS[0];
  const min = Math.min(...points);
  const max = Math.max(...points);
  if (max === min) return BARS[4].repeat(points.length);
  return points
    .map((p) => {
      const idx = Math.round(((p - min) / (max - min)) * (BARS.length - 1));
      return BARS[Math.max(0, Math.min(BARS.length - 1, idx))];
    })
    .join("");
}

function sparklineSvg(samples, { width = 320, height = 80, color = "#45de8e" } = {}) {
  if (!samples?.length) return null;
  const pts = samples.slice(-40);
  const values = pts.map((s) => s.p);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 4;
  const coords = values.map((v, i) => {
    const x = pad + (i / Math.max(1, values.length - 1)) * (width - pad * 2);
    const y = max === min
      ? height / 2
      : height - pad - ((v - min) / (max - min)) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#0b1228"/><polyline fill="none" stroke="${color}" stroke-width="2" points="${coords}"/></svg>`;
}

module.exports = { sparklineFromSamples, sparklineSvg, BARS };
