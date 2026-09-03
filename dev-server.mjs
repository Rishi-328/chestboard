// Local dev server: serves the static files AND proxies /api/chestbox/* to a
// running chestbox, exactly as the Vercel function does in production.
//
// This is what makes local development work without adding a CORS layer to
// chestbox — the browser only ever talks to this origin.
//
//   CHESTBOX_URL=http://localhost:3000 \
//   CHESTBOX_ADMIN_KEY=local-secret \
//   node dev-server.mjs
//
// Then open http://localhost:4173

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT ?? 4173);
const CHESTBOX_URL = (process.env.CHESTBOX_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ADMIN_KEY = process.env.CHESTBOX_ADMIN_KEY ?? "";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const root = new URL(".", import.meta.url).pathname;

const body = (req) =>
  new Promise((resolve) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => resolve(buf));
  });

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ---- proxy ----
  if (url.pathname.startsWith("/api/chestbox/")) {
    if (!ADMIN_KEY) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ message: "CHESTBOX_ADMIN_KEY is not set" }));
    }
    const target = CHESTBOX_URL + url.pathname.replace("/api/chestbox", "") + url.search;
    try {
      const payload = ["GET", "HEAD"].includes(req.method) ? undefined : await body(req);
      const upstream = await fetch(target, {
        method: req.method,
        headers: { "Content-Type": "application/json", "x-admin-api-key": ADMIN_KEY },
        body: payload || undefined,
      });
      const text = await upstream.text();
      res.writeHead(upstream.status, {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      });
      return res.end(text);
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ message: `Cannot reach ${CHESTBOX_URL}: ${e.message}` }));
    }
  }

  // ---- static ----
  const rel = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = join(root, normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  }
}).listen(PORT, () => {
  console.log(`chestboard  http://localhost:${PORT}`);
  console.log(`proxying    /api/chestbox/* -> ${CHESTBOX_URL}`);
});
