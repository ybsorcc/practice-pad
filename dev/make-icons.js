// Renders the app icons (four colour squares on graph paper) to ../icons with Chromium. Usage: node make-icons.js
const path = require("path");
const { chromium } = require("playwright");
const svg = (size, inner, radius) => {
  const s = inner, o = (1 - s) / 2, gap = 0.05 * s, q = (s - gap) / 2, r = q * 0.16;
  const sq = (x, y, c) => `<rect x="${(o + x) * size}" y="${(o + y) * size}" width="${q * size}" height="${q * size}" rx="${r * size}" fill="${c}" stroke="#1e2530" stroke-width="${size * 0.012}"/>`;
  const grid = Array.from({ length: 12 }, (_, i) => { const p = (i + 0.5) * size / 12;
    return `<path d="M${p} 0V${size}M0 ${p}H${size}" stroke="#e3e8ee" stroke-width="${size * 0.006}"/>`; }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${radius * size}" fill="#f4f6f8"/>${grid}
    ${sq(0, 0, "#f3d36b")}${sq(q + gap, 0, "#a8c76c")}${sq(0, q + gap, "#a9c3ea")}${sq(q + gap, q + gap, "#bb9edb")}</svg>`;
};
(async () => {
  const b = await chromium.launch(), p = await b.newPage();
  const out = path.resolve(__dirname, "..", "icons");
  const jobs = [["icon-192.png", 192, 0.68, 0.2], ["icon-512.png", 512, 0.68, 0.2], ["icon-maskable-512.png", 512, 0.56, 0], ["apple-touch-icon.png", 180, 0.64, 0]];
  for (const [name, size, inner, rad] of jobs) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<body style="margin:0;background:transparent">${svg(size, inner, rad)}</body>`);
    await p.screenshot({ path: path.join(out, name), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  }
  await b.close(); console.log("icons written");
})();
