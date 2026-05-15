import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "0.0.0.0";
const scrapeIntervalMs = Number(process.env.SCRAPE_INTERVAL_MS ?? 60000);
let scraping = false;
const clients = new Set();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://localhost:${port}`);

    if (url.pathname === "/events") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive"
      });
      response.write(`event: hello\ndata: ${JSON.stringify({ ok: true, intervalMs: scrapeIntervalMs })}\n\n`);
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }

    const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const filePath = path.normalize(path.join(root, requestedPath));

    if (!filePath.startsWith(root)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    const body = await fs.readFile(filePath);
    response.writeHead(200, { "content-type": contentType(filePath), "cache-control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Live dashboard: http://${host}:${port}`);
  console.log(`Scraper interval: ${Math.round(scrapeIntervalMs / 1000)}s`);
});

runScrape();
setInterval(runScrape, scrapeIntervalMs);

function runScrape() {
  if (scraping) return;
  scraping = true;

  const child = spawn(process.execPath, ["scripts/scrape-news.mjs"], {
    cwd: root,
    stdio: "inherit"
  });

  child.on("exit", () => {
    scraping = false;
    broadcast({ type: "scrape-complete", generatedAt: new Date().toISOString() });
  });
}

function broadcast(payload) {
  const data = `event: update\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    client.write(data);
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8"
    }[ext] ?? "application/octet-stream"
  );
}
