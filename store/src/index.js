/**
 * Family plan store for the Ishaan week picker.
 *
 * Reads are public (the plan is already on a public site).
 * Writes require the FAMILY_SYNC_KEY Worker secret, sent by the browser as
 * the X-Family-Code header. That secret is never embedded in the page.
 */

const DEFAULT_ORIGINS = [
  "https://ishaan-week-picker.deed.page",
  "https://vikramhemrajani.github.io"
];

const WEEK_KINDS = new Set(["free", "ib", "sat", "light"]);
const MAX_BODY = 1500000;
const MAX_CHOICES = 200;
const MAX_TOPICS = 500;

export function isMonday(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return false;
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return false;
  return dt.getUTCDay() === 1;
}

/** Constant-time compare. Length is mixed in so a mismatch still walks both strings. */
export function keysEqual(a, b) {
  const sa = String(a || "");
  const sb = String(b || "");
  const n = Math.max(sa.length, sb.length);
  let diff = sa.length ^ sb.length;
  for (let i = 0; i < n; i++) {
    const ca = i < sa.length ? sa.charCodeAt(i) : 0;
    const cb = i < sb.length ? sb.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

export function nowHktIso(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+08:00`;
}

function clip(value, max) {
  if (typeof value !== "string") return "";
  return value.length > max ? value.slice(0, max) : value;
}

export function sanitisePlan(body, weekStart) {
  const src = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const choicesIn = Array.isArray(src.choices) ? src.choices.slice(0, MAX_CHOICES) : [];
  const choices = [];
  for (const row of choicesIn) {
    if (!row || typeof row !== "object") continue;
    const id = clip(String(row.id || ""), 80);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) continue;
    const kind = WEEK_KINDS.has(row.kind) ? row.kind : "free";
    const out = {
      id,
      day: clip(String(row.day || ""), 80),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(row.date || "")) ? String(row.date) : "",
      start: /^\d{2}:\d{2}$/.test(String(row.start || "")) ? String(row.start) : "",
      end: /^\d{2}:\d{2}$/.test(String(row.end || "")) ? String(row.end) : "",
      kind
    };
    if (kind === "ib") {
      if (row.subject) out.subject = clip(String(row.subject), 120);
      if (row.topic) out.topic = clip(String(row.topic), 500);
    } else if (kind === "sat") {
      if (row.area) out.area = clip(String(row.area), 120);
      if (row.topic) out.topic = clip(String(row.topic), 500);
    }
    choices.push(out);
  }
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);
  const totals = src.totals && typeof src.totals === "object" ? src.totals : {};
  const counts = src.counts && typeof src.counts === "object" ? src.counts : {};
  return {
    weekStart,
    weekLabel: clip(String(src.weekLabel || ""), 80),
    updatedAt: null,
    source: clip(String(src.source || "Save family plan"), 80) || "Save family plan",
    timezone: "Asia/Hong_Kong",
    totals: {
      ib: num(totals.ib),
      sat: num(totals.sat),
      free: num(totals.free),
      light: num(totals.light)
    },
    counts: {
      ib: num(counts.ib),
      sat: num(counts.sat),
      free: num(counts.free),
      light: num(counts.light)
    },
    slotCount: choices.length,
    notes: clip(String(src.notes || ""), 500),
    choices
  };
}

export function sanitiseProgress(body) {
  const src = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const byTopicId = {};
  const incoming = src.byTopicId && typeof src.byTopicId === "object" ? src.byTopicId : {};
  const ids = Object.keys(incoming).slice(0, MAX_TOPICS);
  for (const id of ids) {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) continue;
    const row = incoming[id];
    if (!row || typeof row !== "object") continue;
    const status = clip(String(row.status || "Not started"), 40) || "Not started";
    const last = row.lastTouched == null ? null : clip(String(row.lastTouched), 40);
    byTopicId[id] = {
      status,
      lastTouched: last || null,
      notes: clip(String(row.notes || ""), 2000)
    };
  }
  return {
    version: 1,
    updatedAt: null,
    statusEnum: ["Not started", "Seen in class", "Reviewed once", "Exam-ready"],
    byTopicId
  };
}

function originAllowed(origin, env) {
  if (!origin) return false;
  const extras = String((env && env.ALLOWED_ORIGINS) || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (DEFAULT_ORIGINS.includes(origin) || extras.includes(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return true;
  } catch (e) {
    return false;
  }
  return false;
}

function corsHeaders(origin, env) {
  const headers = { Vary: "Origin" };
  if (origin && originAllowed(origin, env)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, PUT, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, X-Family-Code, If-Match";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

function json(body, status, origin, env, extra) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...corsHeaders(origin, env),
    ...(extra || {})
  };
  return new Response(JSON.stringify(body), { status, headers });
}

function parseRevision(header) {
  if (header == null || header === "" || header === "*") return null;
  const raw = String(header).trim().replace(/^W\//, "").replace(/^"|"$/g, "");
  if (!/^\d+$/.test(raw)) return { invalid: true };
  return { value: Number(raw) };
}

async function readRecord(kv, key) {
  const text = await kv.get(key);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || !parsed.document) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

function familyCode(request) {
  return String(request.headers.get("X-Family-Code") || "").trim();
}

function requireKey(request, env) {
  const expected = String((env && env.FAMILY_SYNC_KEY) || "");
  if (!expected) {
    return { ok: false, status: 503, error: "store_not_configured", message: "The family plan store has no write code yet." };
  }
  const got = familyCode(request);
  if (!got || !keysEqual(expected, got)) {
    return { ok: false, status: 401, error: "family_code_rejected", message: "Family code was not accepted." };
  }
  return { ok: true };
}

async function readBody(request) {
  const length = Number(request.headers.get("content-length") || "0");
  if (length > MAX_BODY) {
    return { error: { status: 413, error: "too_large", message: "That update is too large." } };
  }
  const text = await request.text();
  if (text.length > MAX_BODY) {
    return { error: { status: 413, error: "too_large", message: "That update is too large." } };
  }
  try {
    return { value: text ? JSON.parse(text) : {} };
  } catch (e) {
    return { error: { status: 400, error: "invalid_json", message: "The update was not valid JSON." } };
  }
}

export async function handleRequest(request, env) {
  const origin = request.headers.get("Origin");
  const method = request.method.toUpperCase();
  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return json({ ok: false, error: "bad_url" }, 400, origin, env);
  }
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (method === "OPTIONS") {
    if (origin && !originAllowed(origin, env)) {
      return json({ ok: false, error: "origin_not_allowed" }, 403, origin, env);
    }
    return new Response(null, { status: 204, headers: corsHeaders(origin, env) });
  }

  if (!env || !env.PLANS) {
    return json({ ok: false, error: "store_not_configured", message: "The plan store is missing its database." }, 503, origin, env);
  }

  if (method === "GET" && path === "/v1/health") {
    return json({
      ok: true,
      service: "ishaan-week-picker-store",
      writes: !!String((env && env.FAMILY_SYNC_KEY) || "")
    }, 200, origin, env);
  }

  const weekMatch = path.match(/^\/v1\/weeks\/(\d{4}-\d{2}-\d{2})$/);
  if (weekMatch) {
    const weekStart = weekMatch[1];
    if (!isMonday(weekStart)) {
      return json({ ok: false, error: "bad_week", message: "Week must be a Monday (YYYY-MM-DD)." }, 400, origin, env);
    }
    const kvKey = "week:" + weekStart;
    if (method === "GET") {
      const record = await readRecord(env.PLANS, kvKey);
      if (!record) return json({ ok: false, error: "not_found" }, 404, origin, env);
      return json({
        ok: true,
        revision: record.revision,
        savedAt: record.savedAt,
        weekStart,
        document: record.document
      }, 200, origin, env, { ETag: '"' + record.revision + '"' });
    }
    if (method === "PUT") {
      const parsed = await readBody(request);
      if (parsed.error) {
        return json({ ok: false, error: parsed.error.error, message: parsed.error.message }, parsed.error.status, origin, env);
      }
      const document = sanitisePlan(parsed.value, weekStart);
      return putSanitised(request, env, kvKey, document, weekStart);
    }
    return json({ ok: false, error: "method_not_allowed" }, 405, origin, env);
  }

  if (path === "/v1/progress") {
    const kvKey = "progress";
    if (method === "GET") {
      const record = await readRecord(env.PLANS, kvKey);
      if (!record) return json({ ok: false, error: "not_found" }, 404, origin, env);
      return json({
        ok: true,
        revision: record.revision,
        savedAt: record.savedAt,
        document: record.document
      }, 200, origin, env, { ETag: '"' + record.revision + '"' });
    }
    if (method === "PUT") {
      const parsed = await readBody(request);
      if (parsed.error) {
        return json({ ok: false, error: parsed.error.error, message: parsed.error.message }, parsed.error.status, origin, env);
      }
      const document = sanitiseProgress(parsed.value);
      return putSanitised(request, env, kvKey, document, null);
    }
    return json({ ok: false, error: "method_not_allowed" }, 405, origin, env);
  }

  return json({ ok: false, error: "not_found" }, 404, origin, env);
}

/** Write a document that has already been sanitised. The body is not read again. */
async function putSanitised(request, env, kvKey, document, weekStart) {
  const origin = request.headers.get("Origin");
  if (origin && !originAllowed(origin, env)) {
    return json({ ok: false, error: "origin_not_allowed", message: "This site cannot write the family plan." }, 403, origin, env);
  }
  const auth = requireKey(request, env);
  if (!auth.ok) {
    return json({ ok: false, error: auth.error, message: auth.message }, auth.status, origin, env);
  }
  const savedAt = nowHktIso();
  document.updatedAt = savedAt;
  const current = await readRecord(env.PLANS, kvKey);
  const match = parseRevision(request.headers.get("If-Match"));
  if (match && match.invalid) {
    return json({ ok: false, error: "bad_revision", message: "If-Match was not a revision number." }, 400, origin, env);
  }
  if (match && match.value != null) {
    const currentRev = current ? current.revision : null;
    if (currentRev !== match.value) {
      return json({
        ok: false,
        error: "conflict",
        message: "The family plan changed on another device.",
        revision: current ? current.revision : null,
        savedAt: current ? current.savedAt : null,
        weekStart: weekStart || null,
        document: current ? current.document : null
      }, 409, origin, env);
    }
  }
  const revision = (current && current.revision ? current.revision : 0) + 1;
  await env.PLANS.put(kvKey, JSON.stringify({ revision, savedAt, document }));
  return json({ ok: true, revision, savedAt, weekStart: weekStart || null }, 200, origin, env);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  }
};
