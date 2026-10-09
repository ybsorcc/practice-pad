/* Practice Pad — screenshot reader. Runs entirely on the device.
   1. Find the word tiles (dominant tile colour → connected components → 4-column grid).
   2. Crop each tile, clean it up, and OCR it with Tesseract.js (self-hosted, lazy-loaded).
   3. If no grid is found, OCR the whole image and keep the all-caps words. */
(function () {
  "use strict";
  const PPOCR = { base: null };
  let worker = null, loading = null;

  const WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -'&.";
  // Connections UI text that the whole-image fallback must ignore.
  const UI_WORDS = new Set(("CREATE FOUR GROUPS OF MISTAKES REMAINING SHUFFLE DESELECT ALL SUBMIT " +
    "VPN NYT GAMES CONNECTIONS THE NEW YORK TIMES").split(" "));

  function baseUrl() { return PPOCR.base || new URL("vendor/tesseract/", document.baseURI).href; }

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("Could not load " + src));
      document.head.appendChild(s);
    });
  }

  async function getWorker(progress) {
    if (worker) return worker;
    if (!loading) loading = (async () => {
      const b = baseUrl();
      if (!window.Tesseract) await loadScript(b + "tesseract.min.js");
      progress && progress("Getting the reader ready… (first time only)");
      const w = await Tesseract.createWorker("eng", 1, {
        workerPath: b + "worker.min.js",
        corePath: b + "core/",
        langPath: b + "lang",
        workerBlobURL: false,
        gzip: true,
      });
      await w.setParameters({ tessedit_char_whitelist: WHITELIST, tessedit_pageseg_mode: "6" });
      worker = w; return w;
    })().catch(e => { loading = null; throw e; });
    return loading;
  }

  async function toBitmap(blob) {
    if (window.createImageBitmap) { try { return await createImageBitmap(blob); } catch (e) { /* fall through */ } }
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image(); img.src = url; await img.decode(); return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }

  function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }

  /* ---------- tile detection ---------- */
  function detectTiles(img) {
    const W0 = img.width, H0 = img.height;
    const scale = Math.min(1, 700 / Math.max(W0, H0));
    const W = Math.round(W0 * scale), H = Math.round(H0 * scale);
    const c = canvas(W, H), ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;

    // Histogram of 5-bit-per-channel colours; track the mean colour of each bin.
    const cnt = new Uint32Array(32768), sr = new Float64Array(32768), sg = new Float64Array(32768), sb = new Float64Array(32768);
    for (let i = 0; i < px.length; i += 4) {
      const k = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
      cnt[k]++; sr[k] += px[i]; sg[k] += px[i + 1]; sb[k] += px[i + 2];
    }
    const bins = [];
    for (let k = 0; k < 32768; k++) if (cnt[k] > W * H * 0.004) bins.push(k);
    bins.sort((a, b) => cnt[b] - cnt[a]);
    const cands = [];
    for (const k of bins) {
      const col = [sr[k] / cnt[k], sg[k] / cnt[k], sb[k] / cnt[k]];
      if (cands.some(o => dist(o, col) < 14)) continue;
      cands.push(col);
      if (cands.length >= 8) break;
    }

    let best = null, bars = 0;
    for (const col of cands) {
      const r = gridFor(px, W, H, col);
      bars += r.bars;
      if (r.grid && (!best || r.grid.found > best.found)) best = r.grid;
    }
    if (!best) return { bars };
    const inv = 1 / scale;
    best.cells = best.cells.map(r => ({ x: r.x * inv, y: r.y * inv, w: r.w * inv, h: r.h * inv }));
    best.bars = bars;
    return best;
  }

  function dist(a, b) { return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])); }

  function gridFor(px, W, H, col) {
    const tol = 16, mask = new Uint8Array(W * H);
    for (let i = 0, p = 0; p < mask.length; i += 4, p++) {
      if (Math.abs(px[i] - col[0]) <= tol && Math.abs(px[i + 1] - col[1]) <= tol && Math.abs(px[i + 2] - col[2]) <= tol) mask[p] = 1;
    }
    // Connected components (4-connectivity) with bounding boxes.
    const lab = new Int32Array(W * H), stack = new Int32Array(W * H), comps = [];
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p] || lab[p]) continue;
      const id = comps.length + 1; let sp = 0, n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
      stack[sp++] = p; lab[p] = id;
      while (sp) {
        const q = stack[--sp], x = q % W, y = (q - x) / W; n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && mask[q - 1] && !lab[q - 1]) { lab[q - 1] = id; stack[sp++] = q - 1; }
        if (x < W - 1 && mask[q + 1] && !lab[q + 1]) { lab[q + 1] = id; stack[sp++] = q + 1; }
        if (y > 0 && mask[q - W] && !lab[q - W]) { lab[q - W] = id; stack[sp++] = q - W; }
        if (y < H - 1 && mask[q + W] && !lab[q + W]) { lab[q + W] = id; stack[sp++] = q + W; }
      }
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      comps.push({ x: x0, y: y0, w, h, n });
    }
    // Solved-group bars: wide, strongly coloured rectangles (yellow/green/blue/purple), not grey UI strips.
    const saturated = Math.max(...col) - Math.min(...col) > 40;
    const bars = saturated ? comps.filter(r => r.w > W * 0.6 && r.w / r.h > 3 && r.h > H * 0.03 && r.n / (r.w * r.h) >= 0.55).length : 0;
    const none = { bars, grid: null };
    const minArea = W * H * 0.002, maxArea = W * H * 0.08;
    let tiles = comps.filter(r => {
      const a = r.w * r.h, ar = r.w / r.h;
      return a >= minArea && a <= maxArea && r.n / a >= 0.55 && ar > 0.6 && ar < 3;
    });
    if (tiles.length < 3) return none;
    const med = arr => { const s = arr.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
    const mw = med(tiles.map(t => t.w)), mh = med(tiles.map(t => t.h));
    tiles = tiles.filter(t => Math.abs(t.w - mw) < mw * 0.2 && Math.abs(t.h - mh) < mh * 0.2);
    if (tiles.length < 3) return none;

    const cluster = (vals, gap) => {
      const s = vals.slice().sort((a, b) => a - b), out = [];
      for (const v of s) { const last = out[out.length - 1]; if (last && v - last.at(-1) < gap) last.push(v); else out.push([v]); }
      return out.map(g => g.reduce((a, b) => a + b, 0) / g.length);
    };
    const cols = cluster(tiles.map(t => t.x + t.w / 2), mw / 2);
    const rows = cluster(tiles.map(t => t.y + t.h / 2), mh / 2);
    if (cols.length !== 4 || rows.length < 1 || rows.length > 4) return none;
    // Columns must be evenly spaced; rows must be contiguous with the same pitch.
    const pitch = (cols[3] - cols[0]) / 3;
    if (cols.some((c, i) => Math.abs(c - (cols[0] + i * pitch)) > mw * 0.15)) return none;
    for (let i = 1; i < rows.length; i++) if (Math.abs(rows[i] - rows[i - 1] - (mh + (pitch - mw))) > mh * 0.25) return none;

    // Fill the grid; any cell without a matching tile (e.g. a selected tile) uses the inferred position.
    const cells = [];
    let found = 0;
    for (const ry of rows) for (const cx of cols) {
      const t = tiles.find(t => Math.abs(t.x + t.w / 2 - cx) < mw / 2 && Math.abs(t.y + t.h / 2 - ry) < mh / 2);
      if (t) found++;
      cells.push(t ? { x: t.x, y: t.y, w: t.w, h: t.h } : { x: cx - mw / 2, y: ry - mh / 2, w: mw, h: mh });
    }
    if (found < cells.length * 0.6) return none;
    return { bars, grid: { cells, rows: rows.length, found, color: col } };
  }

  /* ---------- per-tile clean-up ---------- */
  function prepTile(img, r) {
    const ix = r.w * 0.05, iy = r.h * 0.06;
    const sx = r.x + ix, sy = r.y + iy, sw = r.w - 2 * ix, sh = r.h - 2 * iy;
    const H = 150, Wd = Math.round(sw * H / sh), pad = 24;
    const c = canvas(Wd + pad * 2, H + pad * 2), ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, sx, sy, sw, sh, pad, pad, Wd, H);
    const d = ctx.getImageData(pad, pad, Wd, H), p = d.data, n = Wd * H;
    const gray = new Uint8Array(n), hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) { const v = (p[i * 4] * 299 + p[i * 4 + 1] * 587 + p[i * 4 + 2] * 114) / 1000 | 0; gray[i] = v; hist[v]++; }
    const t = otsu(hist, n);
    let dark = 0; for (let i = 0; i < n; i++) if (gray[i] <= t) dark++;
    const textIsDark = dark < n / 2; // text is the minority
    let inked = 0;
    for (let i = 0; i < n; i++) {
      const ink = textIsDark ? gray[i] <= t : gray[i] > t;
      if (ink) inked++;
      const v = ink ? 0 : 255; p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = v; p[i * 4 + 3] = 255;
    }
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.putImageData(d, pad, pad);
    return { canvas: c, blank: inked < n * 0.004 };
  }

  function otsu(hist, total) {
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumB = 0, wB = 0, max = 0, th = 127;
    for (let i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue; const wF = total - wB; if (!wF) break;
      sumB += i * hist[i];
      const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > max) { max = v; th = i; }
    }
    return th;
  }

  function cleanWord(text) {
    const lines = text.toUpperCase().split(/\n+/).map(s => s.replace(/[^A-Z0-9 '&.\-]/g, "").trim()).filter(Boolean);
    let out = "";
    for (const l of lines) out = !out ? l : /-$/.test(out) ? out + l : out + " " + l;
    return out.replace(/\s+/g, " ").replace(/^[\s.'\-]+|[\s.'\-]+$/g, "").trim();
  }

  /* ---------- whole-image fallback ---------- */
  async function fallback(w, img) {
    const scale = Math.min(2, 2400 / Math.max(img.width, img.height));
    const c = canvas(Math.round(img.width * scale), Math.round(img.height * scale));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    await w.setParameters({ tessedit_pageseg_mode: "11" });
    try {
      const { data } = await w.recognize(c);
      const words = [];
      for (const raw of data.text.split(/\n+/)) {
        const line = raw.trim();
        if (!line || /[a-z]/.test(line)) continue; // keep all-caps lines only
        for (const tok of line.split(/\s{2,}/)) {
          const t = cleanWord(tok);
          if (t.length < 2 || t.split(" ").every(x => UI_WORDS.has(x))) continue;
          words.push(t);
        }
      }
      return words.slice(0, 16);
    } finally { await w.setParameters({ tessedit_pageseg_mode: "6" }); }
  }

  /* ---------- public ---------- */
  PPOCR.read = async function (blob, progress) {
    const say = m => progress && progress(m);
    say("Opening screenshot…");
    const img = await toBitmap(blob);
    const det = detectTiles(img);
    const grid = det.cells ? det : null;
    // No tiles but solved-group bars: the puzzle is already finished, so there's nothing to sort.
    if (!grid && det.bars > 0) return { words: [], method: "solved", rows: 0, bars: det.bars };
    const w = await getWorker(say);
    if (!grid) {
      say("Reading words…");
      return { words: await fallback(w, img), method: "fallback", rows: 0 };
    }
    const words = [];
    for (let i = 0; i < grid.cells.length; i++) {
      say(`Reading words… ${i + 1} of ${grid.cells.length}`);
      const t = prepTile(img, grid.cells[i]);
      if (t.blank) { words.push(""); continue; }
      const { data } = await w.recognize(t.canvas);
      words.push(cleanWord(data.text));
    }
    return { words, method: "tiles", rows: grid.rows, found: grid.found, bars: grid.bars };
  };
  PPOCR.warmUp = () => getWorker().catch(() => {});
  PPOCR._detect = detectTiles; PPOCR._clean = cleanWord;
  window.PPOCR = PPOCR;
})();
