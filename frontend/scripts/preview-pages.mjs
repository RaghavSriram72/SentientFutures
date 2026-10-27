// Serves the static export the way GitHub Pages does: under /<repo>/.
// A plain server at / would hide base path bugs.
// Usage: NEXT_PUBLIC_BASE_PATH=/SentientFutures npm run build && npm run preview:pages
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "..", "out");
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/SentientFutures";
const port = Number(process.env.PORT ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

if (!fs.existsSync(outDir)) {
  console.error("No out/ folder. Run the build first.");
  process.exit(1);
}

function send(res, status, filePath) {
  const type = TYPES[path.extname(filePath)] ?? "application/octet-stream";
  res.writeHead(status, { "Content-Type": type });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);

  if (!pathname.startsWith(basePath)) {
    res.writeHead(302, { Location: `${basePath}/` });
    res.end();
    return;
  }
  pathname = pathname.slice(basePath.length) || "/";

  let filePath = path.join(outDir, pathname);
  if (!filePath.startsWith(outDir)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }
  if (fs.existsSync(filePath)) {
    send(res, 200, filePath);
    return;
  }
  send(res, 404, path.join(outDir, "404.html"));
});

server.listen(port, () => {
  console.log(`Previewing out/ at http://localhost:${port}${basePath}/`);
});
