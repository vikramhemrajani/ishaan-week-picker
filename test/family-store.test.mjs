import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chooseSharedSource, plansEquivalent } from "../js/family-store.js";
import { handleRequest, isMonday, keysEqual } from "../store/src/index.js";

const ORIGIN = "https://ishaan-week-picker.deed.page";
const CODE = "test-family-code";
const WEEK = "2026-11-23";

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

function envWith(kv, code = CODE) {
  return { PLANS: kv, FAMILY_SYNC_KEY: code };
}

async function call(env, path, { method = "GET", body, code, origin = ORIGIN, ifMatch } = {}) {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  if (code) headers.set("X-Family-Code", code);
  if (ifMatch != null) headers.set("If-Match", String(ifMatch));
  if (body != null) headers.set("content-type", "application/json");
  const res = await handleRequest(new Request("https://store.example" + path, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined
  }), env);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
  return { status: res.status, headers: res.headers, data, text };
}

function plan(choices, extra) {
  return {
    weekStart: WEEK,
    weekLabel: "Mon 23 Nov – Sun 29 Nov 2026",
    source: "Save family plan",
    timezone: "Asia/Hong_Kong",
    totals: { ib: 1, sat: 0, free: 1, light: 0 },
    counts: { ib: 1, sat: 0, free: 1, light: 0 },
    choices,
    secret: "do-not-keep",
    ...extra
  };
}

const seed = JSON.parse(readFileSync(new URL("../choices/2026-11-23.json", import.meta.url), "utf8"));

test("Monday check accepts the live week and rejects the next day", () => {
  assert.equal(isMonday("2026-11-23"), true);
  assert.equal(isMonday("2026-11-24"), false);
  assert.equal(isMonday("2026-11-22"), false);
  assert.equal(isMonday("not-a-date"), false);
});

test("family code compare does not treat a prefix as a match", () => {
  assert.equal(keysEqual("abc", "abc"), true);
  assert.equal(keysEqual("abc", "abd"), false);
  assert.equal(keysEqual("abc", "abcd"), false);
  assert.equal(keysEqual("", "abc"), false);
});

test("a visitor cannot overwrite the plan, and a second browser can read a save", async () => {
  const env = envWith(memoryKv());
  const choices = [{
    id: "mon-23-o0",
    day: "Monday 23 Nov",
    date: "2026-11-23",
    start: "06:00",
    end: "06:45",
    kind: "ib",
    subject: "Physics",
    topic: "A.2 Forces and momentum (SL)"
  }];

  const blocked = await call(env, "/v1/weeks/" + WEEK, { method: "PUT", body: plan(choices) });
  assert.equal(blocked.status, 401);
  assert.equal(blocked.text.includes(CODE), false);
  const stillEmpty = await call(env, "/v1/weeks/" + WEEK, { code: null });
  assert.equal(stillEmpty.status, 404);

  const wrong = await call(env, "/v1/weeks/" + WEEK, {
    method: "PUT",
    code: "someone-else",
    body: plan(choices)
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.text.includes("someone-else"), false);

  const evil = await call(env, "/v1/weeks/" + WEEK, {
    method: "PUT",
    code: CODE,
    origin: "https://evil.example",
    body: plan(choices)
  });
  assert.equal(evil.status, 403);

  const saved = await call(env, "/v1/weeks/" + WEEK, {
    method: "PUT",
    code: CODE,
    body: plan(choices)
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.ok, true);
  assert.equal(saved.data.revision, 1);
  assert.match(saved.data.savedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/);

  const otherBrowser = await call(env, "/v1/weeks/" + WEEK);
  assert.equal(otherBrowser.status, 200);
  assert.equal(otherBrowser.data.document.choices[0].topic, "A.2 Forces and momentum (SL)");
  assert.equal(otherBrowser.data.document.secret, undefined);
  assert.equal(otherBrowser.headers.get("access-control-allow-origin"), ORIGIN);

  const clash = await call(env, "/v1/weeks/" + WEEK, {
    method: "PUT",
    code: CODE,
    ifMatch: 1,
    body: plan([{ ...choices[0], topic: "stale write" }])
  });
  assert.equal(clash.status, 200);
  const lost = await call(env, "/v1/weeks/" + WEEK, {
    method: "PUT",
    code: CODE,
    ifMatch: 1,
    body: plan([{ ...choices[0], topic: "should lose" }])
  });
  assert.equal(lost.status, 409);
  const after = await call(env, "/v1/weeks/" + WEEK);
  assert.equal(after.data.document.choices[0].topic, "stale write");
  assert.equal(after.data.revision, 2);
});

test("writes stay closed when the family code secret is missing", async () => {
  const env = envWith(memoryKv(), "");
  const res = await call(env, "/v1/weeks/" + WEEK, {
    method: "PUT",
    code: CODE,
    body: plan([])
  });
  assert.equal(res.status, 503);
  const health = await call(env, "/v1/health");
  assert.equal(health.data.writes, false);
});

test("topic progress is shared without a second paste", async () => {
  const env = envWith(memoryKv());
  const body = {
    version: 1,
    byTopicId: {
      "physics__a-2__3566f6a136": {
        status: "Reviewed once",
        lastTouched: "2026-11-22T12:00:00.000Z",
        notes: "Done on Ishaan's laptop"
      }
    }
  };
  const put = await call(env, "/v1/progress", { method: "PUT", code: CODE, body });
  assert.equal(put.status, 200);
  const got = await call(env, "/v1/progress");
  assert.equal(got.data.document.byTopicId["physics__a-2__3566f6a136"].status, "Reviewed once");
  assert.equal(got.text.includes(CODE), false);
});

test("preflight allows the family sites and refuses a random site", async () => {
  const env = envWith(memoryKv());
  const ok = await call(env, "/v1/weeks/" + WEEK, { method: "OPTIONS" });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
  assert.match(ok.headers.get("access-control-allow-headers"), /X-Family-Code/);
  const pages = await call(env, "/v1/health", { origin: "https://vikramhemrajani.github.io" });
  assert.equal(pages.headers.get("access-control-allow-origin"), "https://vikramhemrajani.github.io");
  const no = await call(env, "/v1/weeks/" + WEEK, { method: "OPTIONS", origin: "https://evil.example" });
  assert.equal(no.status, 403);
});

test("Dad's browser replaces the Sunday seed when Ishaan has saved a later plan", async () => {
  const env = envWith(memoryKv());
  const ishaanChoices = seed.choices.map((row, index) => {
    if (index !== 0) return row;
    return {
      id: row.id,
      day: row.day,
      date: row.date,
      start: row.start,
      end: row.end,
      kind: "sat",
      area: "Maths",
      topic: "Heart of Algebra"
    };
  });
  assert.equal(plansEquivalent(seed.choices, ishaanChoices), false);

  const ishaanLocal = {
    present: true,
    blank: false,
    dirty: false,
    hasMeta: false,
    matchesFile: false,
    matchesStore: false,
    updatedAt: null,
    revision: null
  };
  const beforeSave = chooseSharedSource({
    local: ishaanLocal,
    store: null,
    file: seed
  });
  assert.equal(beforeSave.source, "local");
  assert.equal(beforeSave.shouldUpload, true);
  assert.equal(beforeSave.remoteNewer, false);

  const saved = await call(env, "/v1/weeks/" + WEEK, {
    method: "PUT",
    code: CODE,
    body: plan(ishaanChoices, { totals: { ib: 6, sat: 0.8, free: 22, light: 0 } })
  });
  assert.equal(saved.status, 200);
  const fromStore = await call(env, "/v1/weeks/" + WEEK);
  const store = {
    revision: fromStore.data.revision,
    updatedAt: fromStore.data.savedAt,
    document: fromStore.data.document
  };

  const dad = chooseSharedSource({
    local: {
      present: true,
      blank: false,
      dirty: false,
      hasMeta: false,
      matchesFile: plansEquivalent(seed.choices, seed.choices),
      matchesStore: plansEquivalent(seed.choices, store.document.choices),
      updatedAt: seed.updatedAt,
      revision: null
    },
    store,
    file: seed
  });
  assert.equal(dad.source, "store");
  assert.equal(dad.plan.choices[0].kind, "sat");
  assert.equal(dad.plan.choices[0].topic, "Heart of Algebra");

  const emptyBrowser = chooseSharedSource({
    local: { present: false, blank: true, dirty: false, hasMeta: false, matchesFile: false, matchesStore: false },
    store,
    file: seed
  });
  assert.equal(emptyBrowser.source, "store");
  assert.equal(emptyBrowser.reason, "no-local");
});

test("a private edit is not overwritten by an older seed, and a clear stays put", () => {
  const kept = chooseSharedSource({
    local: {
      present: true,
      blank: false,
      dirty: true,
      hasMeta: true,
      matchesFile: false,
      matchesStore: false,
      revision: 3
    },
    store: { revision: 3, updatedAt: "2026-11-23T10:00:00+08:00", document: { choices: seed.choices } },
    file: seed
  });
  assert.equal(kept.source, "local");
  assert.equal(kept.remoteNewer, false);

  const conflict = chooseSharedSource({
    local: {
      present: true,
      blank: false,
      dirty: true,
      hasMeta: true,
      matchesFile: false,
      matchesStore: false,
      revision: 3
    },
    store: { revision: 4, updatedAt: "2026-11-23T11:00:00+08:00", document: { choices: seed.choices } },
    file: seed
  });
  assert.equal(conflict.source, "local");
  assert.equal(conflict.remoteNewer, true);

  const cleared = chooseSharedSource({
    local: {
      present: true,
      blank: true,
      dirty: true,
      hasMeta: true,
      matchesFile: false,
      matchesStore: false,
      revision: 2
    },
    store: { revision: 2, updatedAt: "2026-11-23T10:00:00+08:00", document: { choices: seed.choices } },
    file: seed
  });
  assert.equal(cleared.source, "local");
  assert.equal(cleared.reason, "dirty-local");
});
