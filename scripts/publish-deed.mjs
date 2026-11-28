/**
 * Republish the static site to https://ishaan-week-picker.deed.page/
 *
 * The token is read from DEED_TOKEN or ~/.config/deed-page/token.
 * It is never printed. No .env file is read or written.
 *
 *   node scripts/publish-deed.mjs --dry-run
 *   node scripts/publish-deed.mjs
 *
 * A publish sends a complete file map and refuses to continue if index.html
 * is missing. When deed.page reports a version, the request sends If-Match
 * and X-Expected-Version.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SLUG = "ishaan-week-picker";
const API = "https://deed.page";
const LIVE = "https://ishaan-week-picker.deed.page";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dryRun = process.argv.includes("--dry-run");

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "apps-script",
  "store",
  "test",
  ".wrangler"
]);
const INCLUDE_EXT = new Set([".html", ".js", ".json", ".jsonl", ".md", ".mjs"]);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
      continue;
    }
    if (!INCLUDE_EXT.has(path.extname(entry.name))) continue;
    if (entry.name === "package.json") continue;
    const rel = path.relative(root, full).split(path.sep).join("/");
    out.push(rel);
  }
}

function readToken() {
  if (process.env.DEED_TOKEN && process.env.DEED_TOKEN.trim()) {
    return process.env.DEED_TOKEN.trim();
  }
  const file = path.join(os.homedir(), ".config", "deed-page", "token");
  if (!fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf8").trim();
}

function localFiles() {
  const files = [];
  walk(root, files);
  files.sort();
  return files;
}

async function deed(method, urlPath, token, body, extraHeaders) {
  const headers = {
    Authorization: "Bearer " + token,
    Accept: "application/json",
    "X-Client": "ishaan-week-picker-publish"
  };
  if (extraHeaders) Object.assign(headers, extraHeaders);
  const res = await fetch(API + urlPath, {
    method,
    headers,
    body: body == null ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    const message = data.message || data.error || data.code || ("HTTP " + res.status);
    throw new Error("deed.page " + method + " " + urlPath + " failed (" + message + ").");
  }
  return data;
}

function manifestPaths(manifest) {
  const paths = [];
  if (!manifest) return paths;
  const files = manifest.files || manifest.entries || manifest.tree || [];
  if (Array.isArray(files)) {
    for (const file of files) {
      const p = typeof file === "string" ? file : (file.path || file.name || file.file);
      if (p) paths.push(String(p).replace(/^\.\//, ""));
    }
  } else if (files && typeof files === "object") {
    paths.push(...Object.keys(files));
  }
  return paths;
}

const files = localFiles();
if (!files.includes("index.html")) {
  console.error("Refusing to publish: index.html is not in the local file list.");
  process.exit(1);
}
if (!files.includes("js/family-store.js")) {
  console.error("Refusing to publish: js/family-store.js is not in the local file list.");
  process.exit(1);
}

if (dryRun) {
  console.log("Dry run. These local files would be included (" + files.length + "):");
  for (const file of files) console.log("  " + file);
  console.log("A real publish also keeps any live deed.page path that is not in this list,");
  console.log("by downloading it, so older locks and choices are not dropped.");
  console.log("Required: index.html and js/family-store.js are present.");
  process.exit(0);
}

const token = readToken();
if (!token) {
  console.error("Missing deed token. Put it in ~/.config/deed-page/token (mode 600) or DEED_TOKEN.");
  console.error("The token is not printed. Run with --dry-run to list files without it.");
  process.exit(1);
}

let version = null;
try {
  const site = await deed("GET", "/v1/sites/" + SLUG, token);
  version = site.version || site.current_version || site.live_version || null;
} catch (e) {
  try {
    const man = await deed("GET", "/v1/sites/" + SLUG + "/manifest", token);
    version = man.version || (man.site && man.site.version) || null;
  } catch (e2) {
    version = null;
  }
}

const paths = new Set(files);
try {
  const man = await deed("GET", "/v1/sites/" + SLUG + "/manifest", token);
  for (const p of manifestPaths(man)) paths.add(p);
} catch (e) {
  console.log("Could not read the live manifest. Publishing the local file list only.");
}

const fileMap = {};
for (const rel of paths) {
  const local = path.join(root, rel);
  if (fs.existsSync(local) && fs.statSync(local).isFile()) {
    fileMap[rel] = fs.readFileSync(local, "utf8");
    continue;
  }
  const res = await fetch(LIVE + "/" + rel.split("/").map(encodeURIComponent).join("/"));
  if (res.ok) fileMap[rel] = await res.text();
}

if (!fileMap["index.html"]) {
  console.error("Refusing to publish: index.html is missing from the complete file map.");
  process.exit(1);
}
if (!fileMap["js/family-store.js"]) {
  console.error("Refusing to publish: js/family-store.js is missing from the complete file map.");
  process.exit(1);
}

const headers = {};
if (version) {
  const bare = String(version).replace(/^"|"$/g, "");
  headers["If-Match"] = '"' + bare + '"';
  headers["X-Expected-Version"] = bare;
}

const result = await deed(
  "POST",
  "/v1/sites?slug=" + encodeURIComponent(SLUG) + "&ref=ishaan-week-picker-publish",
  token,
  { slug: SLUG, files: fileMap },
  headers
);

const published = result.version || result.current_version || version || "ok";
console.log("Published " + Object.keys(fileMap).length + " files to " + LIVE + " (version " + published + ").");
console.log("Hard-refresh the live site.");
