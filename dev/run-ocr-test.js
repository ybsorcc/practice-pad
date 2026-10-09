// Runs the screenshot reader (the real ocr.js, in Chromium) on every image in ../../test-screenshots
// and compares against expected.json. Usage: node run-ocr-test.js
const fs = require("fs"), path = require("path");
const { chromium } = require("playwright");
const { start } = require("./server");
(async () => {
  const dir = path.resolve(__dirname, "..", "..", "test-screenshots");
  const expected = JSON.parse(fs.readFileSync(path.join(__dirname, "expected.json"), "utf8"));
  const files = fs.readdirSync(dir).filter(f => /\.(png|jpe?g|webp)$/i.test(f));
  if (!files.length) { console.log("No images in test-screenshots/"); process.exit(1); }
  const srv = await start(8766);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("console", m => { if (m.type() === "error") console.log("  [console]", m.text()); });
  await page.goto("http://127.0.0.1:8766/practice-pad/dev/ocr-test.html");
  let allPass = true;
  for (const f of files) {
    const r = await page.evaluate(u => runOne(u), "/test-screenshots/" + encodeURIComponent(f));
    const exp = expected[f];
    const got = r.words;
    let ok = 0;
    const lines = [];
    if (exp) exp.forEach((e, i) => { const g = got[i] || ""; if (g === e) ok++; else lines.push(`    #${i + 1}: expected "${e}", got "${g}"`); });
    const pass = exp && ok === exp.length && got.length === exp.length;
    if (!pass) allPass = false;
    console.log(`${pass ? "PASS" : "FAIL"}  ${f}  ${exp ? ok + "/" + exp.length : "(no expected list)"}  method=${r.method} rows=${r.rows} tilesFound=${r.found} ${r.ms}ms`);
    if (!exp) console.log("    got:", JSON.stringify(got));
    lines.forEach(l => console.log(l));
  }
  await browser.close(); srv.close();
  process.exit(allPass ? 0 : 1);
})();
