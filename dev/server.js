// Tiny static server for local testing. Serves the Connections Sandbox folder
// so the app (/practice-pad/) and the private test images (/test-screenshots/) are both reachable.
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".gz": "application/gzip", ".md": "text/plain" };
function start(port = 8765) {
  return new Promise(res => {
    const srv = http.createServer((req, rsp) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p.endsWith("/")) p += "index.html";
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT)) { rsp.writeHead(403); return rsp.end(); }
      if (req.method === "POST") { rsp.writeHead(405); return rsp.end("POST is handled by the service worker"); }
      fs.readFile(f, (err, buf) => {
        if (err) { rsp.writeHead(404); return rsp.end("not found"); }
        rsp.writeHead(200, { "Content-Type": TYPES[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
        rsp.end(buf);
      });
    }).listen(port, "127.0.0.1", () => res(srv));
  });
}
module.exports = { start };
if (require.main === module) start(+process.argv[2] || 8765).then(() => console.log("http://127.0.0.1:" + (+process.argv[2] || 8765) + "/practice-pad/"));
