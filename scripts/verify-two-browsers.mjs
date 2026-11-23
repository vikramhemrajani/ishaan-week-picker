/**
 * Open the picker in two browser profiles against store/dev-server.mjs.
 * Profile A saves a change. Profile B, with empty storage, must show it.
 *
 *   node scripts/verify-two-browsers.mjs
 *
 * Requires Google Chrome and puppeteer-core (installed next to this run if needed).
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const PORT = process.env.PORT || "8766";
const CODE = "browser-test-family-code";
const CHROME = process.env.CHROME_PATH || "/usr/local/bin/google-chrome";

const puppeteerPath = process.env.PUPPETEER_CORE
  || "/tmp/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const puppeteer = (await import(pathToFileURL(puppeteerPath).href)).default;

const server = spawn(process.execPath, ["store/dev-server.mjs"], {
  cwd: root,
  env: { ...process.env, PORT, FAMILY_SYNC_KEY: CODE },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog += chunk; });
server.stderr.on("data", (chunk) => { serverLog += chunk; });

function fail(message) {
  console.error(message);
  console.error(serverLog);
  server.kill();
  process.exit(1);
}

try {
  for (let i = 0; i < 50; i++) {
    if (serverLog.includes("127.0.0.1:" + PORT)) break;
    await delay(100);
  }
  if (!serverLog.includes("127.0.0.1:" + PORT)) fail("Dev server did not start.");

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });
  const errors = [];
  function watch(page, name) {
    page.on("pageerror", (err) => errors.push(name + " " + err.message));
    page.on("dialog", async (dialog) => {
      errors.push(name + " unexpected dialog: " + dialog.message());
      await dialog.dismiss();
    });
  }

  const contextA = await browser.createBrowserContext();
  const contextB = await browser.createBrowserContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  watch(pageA, "A");
  watch(pageB, "B");
  await pageA.setViewport({ width: 1400, height: 900 });
  await pageB.setViewport({ width: 390, height: 844 });

  const origin = "http://127.0.0.1:" + PORT;
  await pageA.goto(origin + "/", { waitUntil: "networkidle0", timeout: 20000 });
  await pageA.waitForFunction(() => {
    const el = document.getElementById("weekNavLabel");
    return el && /23 Nov/.test(el.textContent) && /29 Nov/.test(el.textContent);
  }, { timeout: 10000 });
  const leaked = await pageA.evaluate((code) => document.documentElement.innerHTML.includes(code), CODE);
  if (leaked) fail("The family code appeared in the page HTML.");

  await pageA.evaluate((code) => localStorage.setItem("ishaan-family-sync-key", code), CODE);
  await pageA.reload({ waitUntil: "networkidle0", timeout: 20000 });
  await pageA.waitForFunction(() => {
    const el = document.getElementById("sharedPlanStatus");
    return el && el.textContent && !/Checking/.test(el.textContent);
  }, { timeout: 10000 });

  const blocked = await pageA.evaluate(async () => {
    const res = await fetch("/v1/weeks/2026-11-23", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ weekStart: "2026-11-23", choices: [] })
    });
    return res.status;
  });
  if (blocked !== 401) fail("A write without the family code returned " + blocked + ", expected 401.");

  const before = await pageA.$eval(".slot.choosable .badge", (el) => el.textContent.trim());
  if (before !== "IB") fail("Expected the hosted seed’s first open slot to be IB, got " + before + ".");
  await pageA.click(".slot.choosable");
  await pageA.waitForFunction(() => {
    const el = document.getElementById("sharedPlanStatus");
    return el && /Other browsers load it automatically/.test(el.textContent);
  }, { timeout: 10000 });
  const afterA = await pageA.$eval(".slot.choosable .badge", (el) => el.textContent.trim());
  if (afterA === before) fail("Clicking a slot did not change it (" + before + ").");

  const labelA = await pageA.$eval("#weekNavLabel", (el) => el.textContent.trim());
  if (!/23 Nov/.test(labelA) || !/29 Nov/.test(labelA)) fail("Opened the wrong week: " + labelA);
  await pageA.click("#btnWeekNext");
  await pageA.waitForFunction((prev) => {
    const el = document.getElementById("weekNavLabel");
    return el && el.textContent.trim() !== prev;
  }, { timeout: 10000 }, labelA);
  await pageA.click("#btnWeekPrev");
  await pageA.waitForFunction((prev) => {
    const el = document.getElementById("weekNavLabel");
    return el && el.textContent.trim() === prev;
  }, { timeout: 10000 }, labelA);

  await pageB.goto(origin + "/#week=2026-11-23", { waitUntil: "networkidle0", timeout: 20000 });
  await pageB.waitForFunction(() => {
    const el = document.getElementById("sharedPlanStatus");
    return el && /Other browsers load it automatically/.test(el.textContent);
  }, { timeout: 10000 });
  const labelB = await pageB.$eval("#weekNavLabel", (el) => el.textContent.trim());
  if (labelB !== labelA) fail("Second browser opened " + labelB + " instead of " + labelA + ".");
  const afterB = await pageB.$eval(".slot.choosable .badge", (el) => el.textContent.trim());
  if (afterB !== afterA) fail("Second browser showed " + afterB + " but the first saved " + afterA + ".");

  await pageB.reload({ waitUntil: "networkidle0", timeout: 20000 });
  await pageB.waitForFunction(() => {
    const el = document.getElementById("sharedPlanStatus");
    return el && /Other browsers load it automatically/.test(el.textContent);
  }, { timeout: 10000 });
  const afterReload = await pageB.$eval(".slot.choosable .badge", (el) => el.textContent.trim());
  if (afterReload !== afterA) fail("Hard reload on the second browser lost the saved plan (" + afterReload + " vs " + afterA + ").");

  await pageA.click("#tab-topics");
  await pageA.waitForSelector("#btnSyncProgress", { timeout: 5000 });
  const topicsVisible = await pageA.$eval("#panel-topics", (el) => el.classList.contains("active"));
  if (!topicsVisible) fail("Topics tab did not open.");

  if (errors.length) fail("Page errors:\n" + errors.join("\n"));

  console.log("Two browsers agree on " + afterA + " (was " + before + ") for week " + labelA + ".");
  await browser.close();
  server.kill();
} catch (err) {
  fail(err && err.stack ? err.stack : String(err));
}
