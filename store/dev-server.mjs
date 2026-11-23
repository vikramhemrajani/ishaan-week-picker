/**
 * Local family-plan store for development and verification.
 * Serves this repo and the Worker on one origin. Not used in production.
 *
 *   FAMILY_SYNC_KEY='a-local-code' node store/dev-server.mjs
 *
 * The family code is read from the environment only. It is not written into
 * index.html. Open http://127.0.0.1:8765/
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { handleRequest } from "./src/index.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const port = Number(process.env.PORT || 8765);
const familyCode = String(process.env.FAMILY_SYNC_KEY || "");

function memoryKv() {
  const map = new Map();
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async put(key, value) {
      map.set(key, String(value));
    }
  };
}

const env = { PLANS: memoryKv(), FAMILY_SYNC_KEY: familyCode };

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonl": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/plain; charset=utf-8"
};

function safeFile(pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = path.normalize(path.join(root, decodeURIComponent(rel)));
  if (!file.startsWith(root + path.sep) && file !== root) return null;
  return file;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  try {
    if (url.pathname.startsWith("/v1/")) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (value == null) continue;
        headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const method = req.method || "GET";
      const request = new Request(url, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : body
      });
      const response = await handleRequest(request, env);
      const buf = Buffer.from(await response.arrayBuffer());
      const out = {};
      response.headers.forEach((value, name) => { out[name] = value; });
      res.writeHead(response.status, out);
      res.end(buf);
      return;
    }

    const file = safeFile(url.pathname);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    let data = fs.readFileSync(file);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const origin = `http://127.0.0.1:${port}`;
      const html = data.toString("utf8").replace(
        'const STORE_API_URL = "";',
        `const STORE_API_URL = ${JSON.stringify(origin)};`
      );
      data = Buffer.from(html);
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      "content-type": types[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Dev server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Ishaan week picker dev store at http://127.0.0.1:${port}/`);
  if (!familyCode) console.log("FAMILY_SYNC_KEY is empty — writes will be refused.");
});
