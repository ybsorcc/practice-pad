// Smoke-tests the published site: loads, service worker, manifest, screenshot reading, offline.
// Usage: node check-live.js [url]
const path = require("path");
const { chromium } = require("playwright");
const URL_ = process.argv[2] || "https://ybsorcc.github.io/practice-pad/";
const SHOT = path.resolve(__dirname, "..", "..", "test-screenshots", "IMG_0844.PNG");
let fails = 0; const check = (ok, m) => { console.log((ok ? "  ok   " : "  FAIL ") + m); if (!ok) fails++; };
(async () => {
  const b = await chromium.launch(), ctx = await b.newContext({ viewport: { width: 412, height: 915 } }), p = await ctx.newPage();
  p.on("pageerror", e => { console.log("  [pageerror]", e.message); fails++; });
  const bad = []; p.on("response", r => { if (r.status() >= 400) bad.push(r.status() + " " + r.url()); });
  await p.goto(URL_);
  check(await p.getByText("Load screenshot").count() === 1, "start screen loads");
  const v = await p.evaluate(() => window.PP_VERSION); console.log("  version", v);
  const m = await p.evaluate(async () => (await fetch("manifest.webmanifest")).json());
  check(m.name === "Practice Pad" && m.share_target && m.icons.length === 3, "manifest OK (name, icons, share_target)");
  await p.waitForFunction(() => navigator.serviceWorker.ready.then(() => true));
  await p.reload(); await p.waitForFunction(() => !!navigator.serviceWorker.controller);
  check(true, "service worker active");
  await p.setInputFiles("#fileIn", SHOT);
  await p.waitForSelector(".editgrid", { timeout: 90000 });
  const w = await p.$$eval(".editgrid input", a => a.map(i => i.value).join(","));
  check(w === "PHONE,SWAY,SCRATCH,WAVE,RIGHT,CHIP,PAPER,DING,CORRECT,SCOPE,TOUCH,GREEN,MOVE,BINGO,CHANGE,REACH", "screenshot read 16/16 from the live site");
  check(/^\d{4}-\d{2}-\d{2}$/.test(await p.inputValue("#pdate")), "puzzle date shown on Check words");
  await p.setInputFiles("#fileIn", path.resolve(__dirname, "..", "..", "test-screenshots", "Screenshot_20261008_205957_NYT Games.jpg"));
  await p.waitForFunction(() => document.querySelector(".editgrid input") && document.querySelector(".editgrid input").value === "CHICAGO", null, { timeout: 60000 });
  check(await p.inputValue("#pdate") === "2026-10-08", "S20 screenshot date read from its file name");
  await ctx.setOffline(true);
  await p.goto(URL_);
  await p.setInputFiles("#fileIn", SHOT);
  await p.waitForSelector(".editgrid", { timeout: 60000 });
  check((await p.$$eval(".editgrid input", a => a[0].value)) === "PHONE", "works offline after first use");
  check(!bad.length, "no failed requests" + (bad.length ? ": " + bad.join(", ") : ""));
  await b.close(); console.log(fails ? fails + " failed" : "All live checks passed"); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
