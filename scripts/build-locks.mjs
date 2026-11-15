#!/usr/bin/env node
/**
 * Build published calendar lock files for the Ishaan week picker.
 *
 * Sources (never invent times except the standing Friday social 13:05–16:00):
 *   - General Timetable
 *   - Study calendar (SAT classes)
 *
 * Classification follows scripts/REFRESH_LOCKS.md.
 *
 * This script does not call Google itself. Feed it event lists already
 * fetched with the Google Calendar MCP list_events tool (or an export
 * with the same shape). Apps Script has a parallel classifier for live
 * refresh after deploy.
 *
 * Usage:
 *   node scripts/build-locks.mjs \
 *     --general /tmp/ishaan-locks-raw/gt-all.json \
 *     --study /tmp/ishaan-locks-raw/study.json \
 *     --out-dir locks \
 *     --from 2026-11-09 \
 *     --to 2027-03-08 \
 *     --latest 2026-11-16
 */

import fs from "node:fs";
import path from "node:path";

const TZ = "Asia/Hong_Kong";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FRIDAY_SOCIAL_START = "13:05";
const FRIDAY_SOCIAL_END = "16:00";

const EXCLUSIONS = ["Bhavan", "Dr OK"];

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) die("Missing value for " + name);
  return v;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function parseISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toISODate(dt) {
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

function addDaysISO(iso, n) {
  const dt = parseISODate(iso);
  dt.setUTCDate(dt.getUTCDate() + n);
  return toISODate(dt);
}

function startOfWeekMonday(iso) {
  const dt = parseISODate(iso);
  const day = dt.getUTCDay(); // 0 Sun
  const diff = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + diff);
  return toISODate(dt);
}

function dowShort(iso) {
  return DOW[parseISODate(iso).getUTCDay()];
}

function padHM(h, m) {
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

/** Parse a dateTime that already carries its offset; never reinterpret scheduledTimeZone. */
function eventLocalParts(timed) {
  const raw = timed && (timed.dateTime || timed.date);
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { date: raw, hm: "00:00", allDay: true };
  }
  const m = raw.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:[+-]\d{2}:\d{2}|Z)?/
  );
  if (!m) return null;
  return { date: m[1], hm: m[2] + ":" + m[3], allDay: false };
}

function minutesBetween(startHm, endHm) {
  const [sh, sm] = startHm.split(":").map(Number);
  const [eh, em] = endHm.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

function hmToMin(hm) {
  const [h, m] = String(hm).split(":").map(Number);
  return h * 60 + m;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return hmToMin(aStart) < hmToMin(bEnd) && hmToMin(bStart) < hmToMin(aEnd);
}

function loadEvents(file) {
  if (!file) return [];
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.events)) return raw.events;
  if (Array.isArray(raw.items)) return raw.items;
  die("No events array in " + file);
}

function titleOf(ev) {
  return String(ev.summary || ev.title || "").trim();
}

function organizerEmail(ev) {
  const org = ev.organizer || {};
  return String(org.email || ev.organizerEmail || "").trim().toLowerCase();
}

function descriptionOf(ev) {
  return String(ev.description || "");
}

function isCancelled(ev) {
  return String(ev.status || "").toLowerCase() === "cancelled";
}

function isTransparent(ev) {
  return String(ev.transparency || "").toLowerCase() === "transparent";
}

function isDraftStudy(title) {
  return /^DRAFT\s*·/i.test(title) || /^DRAFT\s+·/i.test(title);
}

function isExcluded(title) {
  const t = title.toLowerCase();
  if (t.includes("bhavan")) return true;
  if (/\bdr\.?\s*ok\b/i.test(title)) return true;
  return false;
}

function isSchoolPeriod(title) {
  // Island School period codes, e.g. "12WW: 12WW", "12EN501: 12EN5"
  return /^\d{1,2}[A-Z]{2}\d*/i.test(title);
}

function isTutor(title) {
  const t = title.toLowerCase();
  if (/ghosh/.test(t)) return true;
  if (/english\s*tutor/.test(t)) return true;
  if (/history\s*tutor/.test(t)) return true;
  if (/math(?:s)?\s*tutor/.test(t)) return true;
  if (/physics\s*(ms\.?\s*)?ghosh/.test(t)) return true;
  return false;
}

function isZuperscoreOrSatClassTitle(title) {
  const t = title.toLowerCase();
  return (
    t.includes("zuperscore") ||
    t.includes("sat class") ||
    t.includes("sat reading") ||
    t.includes("sat writing") ||
    t.includes("sat prep") ||
    t.includes("prep_review") ||
    t.includes("prep review")
  );
}

function isStudySatClass(ev) {
  const title = titleOf(ev);
  const org = organizerEmail(ev);
  const desc = descriptionOf(ev);
  const blob = `${title}\n${org}\n${desc}`.toLowerCase();
  if (isZuperscoreOrSatClassTitle(title)) return true;
  if (org.includes("zuperscore")) return true;
  if (org.includes("thephoenixedu.com")) return true;
  if (org.includes("pulki")) return true;
  if (/\bpulki\b/.test(blob)) return true;
  if (/\bphoenix\b/.test(blob) && /60\s*mins/i.test(title + desc)) return true;
  if (/60\s*mins(?:\s+class)?\s*-?\s*ishaan/i.test(title)) return true;
  if (/60\s*mins class/i.test(title)) return true;
  return false;
}

function satClassTitle(ev, source) {
  const raw = titleOf(ev);
  const org = organizerEmail(ev);
  if (/zuperscore/i.test(raw) && source === "General Timetable") return raw;
  let who = "";
  if (/pulki/i.test(org) || /\bpulki\b/i.test(raw)) who = "Pulki";
  else if (/poorvi/i.test(org) || /poorvi/i.test(raw)) who = "Zuperscore";
  else if (/krati/i.test(org) || /zuperscore/i.test(org) || /zuperscore/i.test(raw)) who = "Zuperscore";
  else if (/tisha/i.test(org) || /varghese/i.test(org) || /phoenix/i.test(org) || /phoenix/i.test(raw)) who = "Phoenix";
  const short = raw.replace(/\s*[-–—]\s*Ishaan\s*$/i, "").trim();
  if (who) return "SAT class · " + who + (short ? " (" + short + ")" : "");
  return "SAT class · " + (short || raw || "booked class");
}

function tutorTitle(title) {
  const t = title.trim();
  if (/ghosh/i.test(t)) return t || "Physics Ms Ghosh";
  return t;
}

function nowHktStamp() {
  const d = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+08:00`;
}

function eventId(ev) {
  return String(ev.id || ev.iCalUID || ev.htmlLink || titleOf(ev) + dtKey(ev));
}

function dtKey(ev) {
  const s = ev.start || {};
  return s.dateTime || s.date || "";
}

function classifyGeneral(ev) {
  if (isCancelled(ev) || isTransparent(ev)) return null;
  const title = titleOf(ev);
  if (!title) return null;
  if (isDraftStudy(title) || isExcluded(title)) return null;
  const start = eventLocalParts(ev.start);
  const end = eventLocalParts(ev.end);
  if (!start || !end || start.allDay) return null;

  if (isSchoolPeriod(title)) {
    return {
      kind: "school-period",
      id: eventId(ev),
      title,
      date: start.date,
      start: start.hm,
      end: end.hm,
      source: "General Timetable",
      sourceTitle: title
    };
  }
  if (isZuperscoreOrSatClassTitle(title)) {
    return {
      kind: "sat_class",
      id: eventId(ev),
      title: title,
      date: start.date,
      start: start.hm,
      end: end.hm,
      minutes: minutesBetween(start.hm, end.hm),
      satTutor: true,
      source: "General Timetable",
      sourceTitle: title,
      day: dowShort(start.date)
    };
  }
  if (isTutor(title)) {
    return {
      kind: "tutor",
      id: eventId(ev),
      title: tutorTitle(title),
      date: start.date,
      start: start.hm,
      end: end.hm,
      minutes: minutesBetween(start.hm, end.hm),
      satTutor: false,
      source: "General Timetable",
      sourceTitle: title,
      day: dowShort(start.date)
    };
  }
  return null; // do not invent or classify unknown GT events
}

function classifyStudy(ev) {
  if (isCancelled(ev) || isTransparent(ev)) return null;
  const title = titleOf(ev);
  if (!title) return null;
  if (isDraftStudy(title) || isExcluded(title)) return null;
  if (!isStudySatClass(ev)) return null; // e.g. History-tutor mirror, Telos — skip
  const start = eventLocalParts(ev.start);
  const end = eventLocalParts(ev.end);
  if (!start || !end || start.allDay) return null;
  const pretty = satClassTitle(ev, "Study");
  return {
    kind: "sat_class",
    id: eventId(ev),
    title: pretty,
    date: start.date,
    start: start.hm,
    end: end.hm,
    minutes: minutesBetween(start.hm, end.hm),
    satTutor: true,
    source: "Study",
    sourceTitle: title,
    day: dowShort(start.date)
  };
}

function collapseSchool(periods, date) {
  if (!periods.length) return null;
  const start = periods.reduce((m, p) => (p.start < m ? p.start : m), periods[0].start);
  const end = periods.reduce((m, p) => (p.end > m ? p.end : m), periods[0].end);
  return {
    id: "school-" + date,
    title: "School",
    date,
    day: dowShort(date),
    start,
    end,
    minutes: minutesBetween(start, end),
    kind: "school",
    satTutor: false,
    source: "General Timetable",
    sourceTitle: "School (collapsed periods)"
  };
}

function fridaySocial(date) {
  return {
    id: "social-" + date,
    title: "Social time",
    date,
    day: "Fri",
    start: FRIDAY_SOCIAL_START,
    end: FRIDAY_SOCIAL_END,
    minutes: minutesBetween(FRIDAY_SOCIAL_START, FRIDAY_SOCIAL_END),
    kind: "social",
    satTutor: false,
    source: "rule",
    sourceTitle: "Fri social after early finish"
  };
}

function sameSlot(a, b) {
  return a.date === b.date && rangesOverlap(a.start, a.end, b.start, b.end) && a.kind === b.kind;
}

function dedupeLocks(locks) {
  const out = [];
  for (const lock of locks) {
    const hit = out.findIndex((x) => sameSlot(x, lock));
    if (hit === -1) {
      out.push(lock);
      continue;
    }
    const existing = out[hit];
    // Prefer General Timetable when both calendars carry the same SAT class.
    const preferNew =
      (lock.source === "General Timetable" && existing.source !== "General Timetable") ||
      (lock.source === existing.source && (lock.title || "").length > (existing.title || "").length);
    if (preferNew) out[hit] = lock;
  }
  return out;
}

function buildWeek(weekStart, classified, fetchedAt) {
  const weekEnd = addDaysISO(weekStart, 6);
  const inWeek = classified.filter((x) => x.date >= weekStart && x.date <= weekEnd);
  const locks = [];
  for (let i = 0; i < 7; i++) {
    const date = addDaysISO(weekStart, i);
    const dayItems = inWeek.filter((x) => x.date === date);
    const periods = dayItems.filter((x) => x.kind === "school-period");
    const rest = dayItems.filter((x) => x.kind !== "school-period");
    const school = collapseSchool(periods, date);
    if (school) locks.push(school);
    for (const item of rest) locks.push(item);
    if (dowShort(date) === "Fri") {
      const hasSocial = locks.some(
        (L) => L.date === date && L.kind === "social" && L.start === FRIDAY_SOCIAL_START && L.end === FRIDAY_SOCIAL_END
      );
      if (!hasSocial) locks.push(fridaySocial(date));
    }
  }
  const deduped = dedupeLocks(locks).sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
    return (a.end || "").localeCompare(b.end || "");
  });
  return {
    weekStart,
    weekEnd,
    timezone: TZ,
    fetchedAt,
    sources: [
      "General Timetable (Google Calendar)",
      "Study calendar (SAT classes)"
    ],
    exclusions: EXCLUSIONS.slice(),
    notes:
      "School periods collapsed per day. DRAFT study events and other transparent events ignored. SAT booked classes from the Study calendar (and Zuperscore on General Timetable) included as sat_class locks. Friday social 13:05–16:00 is a standing rule.",
    locks: deduped
  };
}

function main() {
  const generalFile = arg("--general");
  const studyFile = arg("--study");
  const outDir = arg("--out-dir", "locks");
  const fromRaw = arg("--from");
  const toRaw = arg("--to");
  const latestRaw = arg("--latest");
  if (!generalFile || !fromRaw || !toRaw) {
    die("Usage: node build-locks.mjs --general gt.json [--study study.json] --from YYYY-MM-DD --to YYYY-MM-DD [--latest YYYY-MM-DD] [--out-dir locks]");
  }
  const from = startOfWeekMonday(fromRaw);
  const to = startOfWeekMonday(toRaw);
  const latest = startOfWeekMonday(latestRaw || from);
  const fetchedAt = nowHktStamp();

  const classified = [];
  for (const ev of loadEvents(generalFile)) {
    const row = classifyGeneral(ev);
    if (row) classified.push(row);
  }
  for (const ev of loadEvents(studyFile)) {
    const row = classifyStudy(ev);
    if (row) classified.push(row);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const weeks = [];
  for (let ws = from; ws <= to; ws = addDaysISO(ws, 7)) {
    const doc = buildWeek(ws, classified, fetchedAt);
    const dest = path.join(outDir, ws + ".json");
    fs.writeFileSync(dest, JSON.stringify(doc, null, 2) + "\n");
    weeks.push({ weekStart: ws, locks: doc.locks.length, path: dest });
    const sat = doc.locks.filter((L) => L.kind === "sat_class");
    const tutors = doc.locks.filter((L) => L.kind === "tutor").map((L) => `${L.date} ${L.start}–${L.end} ${L.title}`);
    const sats = sat.map((L) => `${L.date} ${L.start}–${L.end} ${L.title} [${L.source}]`);
    console.log(
      ws +
        "  locks=" +
        doc.locks.length +
        "  school=" +
        doc.locks.filter((L) => L.kind === "school").length +
        "  tutor=" +
        doc.locks.filter((L) => L.kind === "tutor").length +
        "  sat=" +
        sat.length +
        "  social=" +
        doc.locks.filter((L) => L.kind === "social").length
    );
    if (sats.length) sats.forEach((s) => console.log("    sat_class  " + s));
    if (hasFlag("--verbose") && tutors.length) tutors.forEach((s) => console.log("    tutor      " + s));
  }
  const latestDoc = {
    weekStart: latest,
    path: "locks/" + latest + ".json",
    fetchedAt
  };
  fs.writeFileSync(path.join(outDir, "latest.json"), JSON.stringify(latestDoc, null, 2) + "\n");
  console.log("Wrote " + weeks.length + " week files + latest.json (" + latest + ") fetchedAt=" + fetchedAt);
}

main();
