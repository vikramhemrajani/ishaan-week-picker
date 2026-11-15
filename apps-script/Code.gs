/**
 * Ishaan week picker sync backend.
 *
 * Execute as Vikram, access Anyone. Family sync key lives in Script Properties
 * (FAMILY_SYNC_KEY) — never in this file, never in logs, never in responses.
 * DEED_TOKEN and GITHUB_TOKEN are also Script Properties only.
 *
 * Public actions (no key): getLocks
 * Key required: syncWeek, writeProgress, refreshLocks
 */

var TZ = 'Asia/Hong_Kong';
var DEED_SLUG = 'ishaan-week-picker';
var DEED_HOST = 'https://ishaan-week-picker.deed.page';
var DEED_API = 'https://deed.page';
var GITHUB_REPO = 'vikramhemrajani/ishaan-week-picker';
var GITHUB_BRANCH = 'main';
var PICKER_URL = 'https://ishaan-week-picker.deed.page/';
var GENERAL_TIMETABLE_ID = 'b6d79ffabd2be1218259fa817d90e07a59bb500ca10be63acc3e96a4ee00c36b@group.calendar.google.com';
var STUDY_CALENDAR_ID = 'ishaanvhemrajani@gmail.com';
var WEEK_PLAN_BACK = 4;
var WEEK_PLAN_AHEAD = 16;
var FRIDAY_SOCIAL_START = '13:05';
var FRIDAY_SOCIAL_END = '16:00';
var EXCLUSIONS = ['Bhavan', 'Dr OK'];
var TAG = '[ISHAAN_WEEK_PICKER]';

var KNOWN_PUBLIC_FILES = [
  'index.html',
  'README.md',
  'SYNC.md',
  'topics.json',
  'progress.json',
  'audit/choices-log.jsonl',
  'choices/2026-11-09.json',
  'choices/2026-11-16.json',
  'scripts/REFRESH_LOCKS.md',
  'locks/latest.json'
];

function prop_(name) {
  return String(PropertiesService.getScriptProperties().getProperty(name) || '');
}

function requireProp_(name) {
  var v = prop_(name);
  if (!v) throw new Error('Server is missing ' + name + '. Set it in Script Properties at deploy time.');
  return v;
}

/** Constant-time string compare (also differs on length). */
function keysEqual_(a, b) {
  var sa = String(a || '');
  var sb = String(b || '');
  var n = Math.max(sa.length, sb.length);
  var diff = sa.length ^ sb.length;
  var i;
  for (i = 0; i < n; i++) {
    var ca = i < sa.length ? sa.charCodeAt(i) : 0;
    var cb = i < sb.length ? sb.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

function requireFamilyKey_(payload) {
  var expected = requireProp_('FAMILY_SYNC_KEY');
  var got = payload && (payload.familyKey || payload.family_key || payload.key);
  if (!keysEqual_(expected, String(got || '').trim())) {
    throw new Error('Family sync key was not accepted.');
  }
}

function nowHktIso_() {
  return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss") + '+08:00';
}

function todayHkt_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function addDaysISO_(iso, n) {
  var parts = String(iso).split('-');
  var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  d.setUTCDate(d.getUTCDate() + n);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

function startOfWeekMonday_(iso) {
  var parts = String(iso).split('-');
  var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  var day = d.getUTCDay();
  var diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
}

function defaultWeekStart_() {
  var today = todayHkt_();
  var parts = today.split('-');
  var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  if (d.getUTCDay() === 0) return addDaysISO_(today, 1);
  return startOfWeekMonday_(today);
}

function dowShort_(iso) {
  var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var parts = String(iso).split('-');
  var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  return names[d.getUTCDay()];
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonpResponse_(callback, obj) {
  var name = String(callback || '').replace(/[^A-Za-z0-9_$]/g, '');
  if (!name) name = 'callback';
  return ContentService.createTextOutput(name + '(' + JSON.stringify(obj) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function doGet(e) {
  e = e || { parameter: {} };
  var params = e.parameter || {};
  var action = String(params.action || params.mode || '');
  if (action === 'getLocks' || action === 'locks') {
    var weekStart = startOfWeekMonday_(params.weekStart || params.week || defaultWeekStart_());
    var result;
    try {
      result = { ok: true, action: 'getLocks', weekStart: weekStart, locksDoc: buildLiveLocksDoc_(weekStart) };
    } catch (err) {
      result = { ok: false, action: 'getLocks', weekStart: weekStart, error: String(err.message || err) };
    }
    if (params.callback) return jsonpResponse_(params.callback, result);
    return jsonResponse_(result);
  }
  return HtmlService.createHtmlOutputFromFile('SyncPopup')
    .setTitle('Ishaan week picker · sync')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  // CORS is not available on Apps Script POST. The planner uses the popup
  // + postMessage path (handleClientRequest). This exists only as a fallback
  // for same-origin or curl tests.
  try {
    var payload = {};
    if (e && e.postData && e.postData.contents) payload = JSON.parse(e.postData.contents);
    return jsonResponse_(handleClientRequest(payload));
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err.message || err) });
  }
}

/**
 * Called from SyncPopup.html via google.script.run.
 * Never return property values, tokens, or the family key.
 */
function handleClientRequest(payload) {
  payload = payload || {};
  var action = String(payload.action || 'syncWeek');
  try {
    if (action === 'getLocks') {
      var week = startOfWeekMonday_(payload.weekStart || defaultWeekStart_());
      return { ok: true, action: action, weekStart: week, locksDoc: buildLiveLocksDoc_(week) };
    }
    requireFamilyKey_(payload);
    if (action === 'syncWeek') return syncWeek_(payload);
    if (action === 'writeProgress') return writeProgress_(payload);
    if (action === 'refreshLocks') return refreshLocks_(payload);
    return { ok: false, error: 'Unknown action: ' + action };
  } catch (err) {
    // Message only — no stack, no tokens.
    return { ok: false, action: action, error: String(err.message || err) };
  }
}

function syncWeek_(payload) {
  var weekStart = startOfWeekMonday_(payload.weekStart || (payload.sharedPlan && payload.sharedPlan.weekStart));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) throw new Error('Missing weekStart.');
  var shared = payload.sharedPlan || payload.sharedDoc || payload.SHARED_PLAN_JSON;
  if (!shared || typeof shared !== 'object') throw new Error('Missing shared plan.');
  shared.weekStart = weekStart;
  shared.source = 'Send to calendar';
  shared.timezone = shared.timezone || TZ;
  shared.updatedAt = shared.updatedAt || nowHktIso_();

  var choices = payload.choices || payload.CHOICES_JSON || [];
  if (!choices.length && shared.choices) {
    choices = shared.choices.filter(function (row) {
      return row && row.kind && row.kind !== 'free';
    });
  }

  var audit = payload.auditEntry || payload.AUDIT_ENTRY_JSON || {};
  audit.ts = audit.ts || shared.updatedAt;
  audit.weekStart = weekStart;
  audit.source = 'Send to calendar';
  audit.note = audit.note || 'Send to calendar';

  var progress = payload.progress || payload.PROGRESS_JSON || null;

  var cal;
  try {
    cal = resyncDrafts_(weekStart, choices);
  } catch (err) {
    throw new Error('Calendar write failed (shared plan was not published): ' + (err.message || err));
  }

  var locksDocs = {};
  var nearby = nearbyWeeks_(weekStart);
  var i;
  for (i = 0; i < nearby.length; i++) {
    try {
      locksDocs[nearby[i]] = buildLiveLocksDoc_(nearby[i]);
    } catch (lockErr) {
      // Locks refresh is best-effort on Send; still publish the plan.
      locksDocs[nearby[i]] = null;
    }
  }

  var pub;
  try {
    pub = publishAll_({
      weekStart: weekStart,
      shared: shared,
      audit: audit,
      progress: progress,
      locksDocs: locksDocs,
      message: 'Send to calendar: shared plan + progress + locks for ' + weekStart
    });
  } catch (err) {
    throw new Error(
      'General Timetable drafts were updated (' + cal.created + ' created, ' +
      cal.deleted + ' removed) but publishing the shared plan failed: ' + (err.message || err)
    );
  }

  return {
    ok: true,
    action: 'syncWeek',
    syncedAt: nowHktIso_(),
    weekStart: weekStart,
    calendarCreated: cal.created,
    calendarDeleted: cal.deleted,
    deedVersion: pub.deedVersion || null,
    githubSha: pub.githubSha || null,
    locksWeeks: Object.keys(locksDocs).filter(function (w) { return !!locksDocs[w]; })
  };
}

function writeProgress_(payload) {
  var progress = payload.progress || payload.PROGRESS_JSON;
  if (!progress || typeof progress !== 'object' || !progress.byTopicId) {
    throw new Error('Missing progress document.');
  }
  progress.updatedAt = progress.updatedAt || nowHktIso_();
  var pub = publishAll_({
    weekStart: payload.weekStart || null,
    shared: null,
    audit: null,
    progress: progress,
    locksDocs: {},
    message: 'Topic progress publish'
  });
  return {
    ok: true,
    action: 'writeProgress',
    syncedAt: nowHktIso_(),
    weekStart: payload.weekStart || null,
    calendarCreated: 0,
    calendarDeleted: 0,
    deedVersion: pub.deedVersion || null,
    githubSha: pub.githubSha || null
  };
}

function refreshLocks_(payload) {
  var weekStart = startOfWeekMonday_(payload.weekStart || defaultWeekStart_());
  var weeks = nearbyWeeks_(weekStart);
  if (payload.weeks && payload.weeks.length) weeks = payload.weeks.map(startOfWeekMonday_);
  var locksDocs = {};
  var i;
  for (i = 0; i < weeks.length; i++) {
    locksDocs[weeks[i]] = buildLiveLocksDoc_(weeks[i]);
  }
  var pub = publishAll_({
    weekStart: weekStart,
    shared: null,
    audit: null,
    progress: null,
    locksDocs: locksDocs,
    message: 'Refresh calendar locks around ' + weekStart
  });
  return {
    ok: true,
    action: 'refreshLocks',
    syncedAt: nowHktIso_(),
    weekStart: weekStart,
    calendarCreated: 0,
    calendarDeleted: 0,
    deedVersion: pub.deedVersion || null,
    githubSha: pub.githubSha || null,
    locksWeeks: Object.keys(locksDocs)
  };
}

/** Time-driven trigger entry (install at deploy if wanted). Does not expose secrets. */
function scheduledRefreshLocks() {
  var week = defaultWeekStart_();
  return refreshLocks_({ weekStart: week, familyKey: requireProp_('FAMILY_SYNC_KEY') });
}

function nearbyWeeks_(weekStart) {
  var ws = startOfWeekMonday_(weekStart);
  return [addDaysISO_(ws, -7), ws, addDaysISO_(ws, 7), addDaysISO_(ws, 14)];
}

/* ---------------- Calendar drafts ---------------- */

function draftTitle_(row) {
  if (row.kind === 'ib') {
    var subj = row.subject || 'IB';
    var topic = row.topic ? ' — ' + row.topic : '';
    return 'DRAFT · Study IB · ' + subj + topic;
  }
  if (row.kind === 'sat') {
    return 'DRAFT · SAT · ' + (row.area || 'SAT');
  }
  return 'DRAFT · Light';
}

function draftDescription_(row, weekStart) {
  var lines = [
    TAG,
    'week:' + weekStart,
    'slot:' + (row.id || ''),
    'kind:' + row.kind,
    'source:picker-sync',
    '',
    row.subject || row.area || '',
    row.topic || '',
    '',
    'Tagged for wipe-and-resync. Not a locked tutor/school block.',
    'Picker: ' + PICKER_URL + '#week=' + weekStart
  ];
  return lines.join('\n');
}

function resyncDrafts_(weekStart, choices) {
  if (typeof Calendar === 'undefined' || !Calendar.Events) {
    throw new Error('Calendar advanced service is not enabled. Enable it before deploy.');
  }
  var start = weekStart + 'T00:00:00+08:00';
  var end = addDaysISO_(weekStart, 7) + 'T00:00:00+08:00';
  var pageToken = null;
  var toDelete = [];
  do {
    var res = Calendar.Events.list(GENERAL_TIMETABLE_ID, {
      timeMin: start,
      timeMax: end,
      singleEvents: true,
      maxResults: 250,
      pageToken: pageToken || undefined,
      showDeleted: false,
      timeZone: TZ
    });
    (res.items || []).forEach(function (ev) {
      var desc = ev.description || '';
      if (desc.indexOf(TAG) !== -1 && desc.indexOf('week:' + weekStart) !== -1) {
        toDelete.push(ev.id);
      }
    });
    pageToken = res.nextPageToken || null;
  } while (pageToken);

  toDelete.forEach(function (id) {
    Calendar.Events.remove(GENERAL_TIMETABLE_ID, id, { sendUpdates: 'none' });
  });

  var created = 0;
  (choices || []).forEach(function (row) {
    if (!row || !row.kind || row.kind === 'free') return;
    if (row.kind !== 'ib' && row.kind !== 'sat' && row.kind !== 'light') return;
    if (!row.date || !row.start || !row.end) throw new Error('Choice is missing date or time (' + (row.id || '?') + ').');
    var colorId = row.kind === 'ib' ? '9' : row.kind === 'sat' ? '6' : '2';
    var ev = {
      summary: draftTitle_(row),
      description: draftDescription_(row, weekStart),
      start: { dateTime: row.date + 'T' + row.start + ':00+08:00', timeZone: TZ },
      end: { dateTime: row.date + 'T' + row.end + ':00+08:00', timeZone: TZ },
      colorId: colorId,
      transparency: 'transparent',
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] }
    };
    Calendar.Events.insert(ev, GENERAL_TIMETABLE_ID, { sendUpdates: 'none' });
    created += 1;
  });
  return { deleted: toDelete.length, created: created };
}

/* ---------------- Locks ---------------- */

function listCalEvents_(calendarId, weekStart) {
  var start = weekStart + 'T00:00:00+08:00';
  var end = addDaysISO_(weekStart, 7) + 'T00:00:00+08:00';
  var pageToken = null;
  var out = [];
  do {
    var res = Calendar.Events.list(calendarId, {
      timeMin: start,
      timeMax: end,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
      pageToken: pageToken || undefined,
      timeZone: TZ,
      showDeleted: false
    });
    (res.items || []).forEach(function (ev) { out.push(ev); });
    pageToken = res.nextPageToken || null;
  } while (pageToken);
  return out;
}

function eventLocalParts_(timed) {
  if (!timed) return null;
  var raw = timed.dateTime || timed.date;
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { date: raw, hm: '00:00', allDay: true };
  var m = String(raw).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return { date: m[1], hm: m[2] + ':' + m[3], allDay: false };
}

function minutesBetween_(a, b) {
  var as = a.split(':').map(Number);
  var bs = b.split(':').map(Number);
  return bs[0] * 60 + bs[1] - (as[0] * 60 + as[1]);
}

function hmToMin_(hm) {
  var p = String(hm).split(':').map(Number);
  return p[0] * 60 + p[1];
}

function rangesOverlap_(aStart, aEnd, bStart, bEnd) {
  return hmToMin_(aStart) < hmToMin_(bEnd) && hmToMin_(bStart) < hmToMin_(aEnd);
}

function titleOf_(ev) { return String(ev.summary || ev.title || '').trim(); }
function orgOf_(ev) { return String((ev.organizer && ev.organizer.email) || '').trim().toLowerCase(); }
function descOf_(ev) { return String(ev.description || ''); }

function isTransparent_(ev) { return String(ev.transparency || '').toLowerCase() === 'transparent'; }
function isCancelled_(ev) { return String(ev.status || '').toLowerCase() === 'cancelled'; }
function isDraftStudy_(title) { return /^DRAFT\s*·/i.test(title); }
function isExcluded_(title) {
  var t = title.toLowerCase();
  return t.indexOf('bhavan') !== -1 || /\bdr\.?\s*ok\b/i.test(title);
}
function isSchoolPeriod_(title) { return /^\d{1,2}[A-Z]{2}\d*/i.test(title); }
function isTutor_(title) {
  var t = title.toLowerCase();
  return /ghosh/.test(t) || /english\s*tutor/.test(t) || /history\s*tutor/.test(t) || /math(?:s)?\s*tutor/.test(t);
}
function isZuperscoreTitle_(title) {
  var t = title.toLowerCase();
  return t.indexOf('zuperscore') !== -1 || t.indexOf('sat class') !== -1 ||
    t.indexOf('sat reading') !== -1 || t.indexOf('sat writing') !== -1 ||
    t.indexOf('sat prep') !== -1 || t.indexOf('prep_review') !== -1 ||
    t.indexOf('prep review') !== -1;
}
function isStudySatClass_(ev) {
  var title = titleOf_(ev);
  var org = orgOf_(ev);
  var desc = descOf_(ev);
  var blob = (title + '\n' + org + '\n' + desc).toLowerCase();
  if (isZuperscoreTitle_(title)) return true;
  if (org.indexOf('zuperscore') !== -1) return true;
  if (org.indexOf('thephoenixedu.com') !== -1) return true;
  if (org.indexOf('pulki') !== -1) return true;
  if (/\bpulki\b/.test(blob)) return true;
  if (/60\s*mins(?:\s+class)?\s*-?\s*ishaan/i.test(title)) return true;
  if (/60\s*mins class/i.test(title)) return true;
  return false;
}

function satClassTitle_(ev, source) {
  var raw = titleOf_(ev);
  var org = orgOf_(ev);
  if (/zuperscore/i.test(raw) && source === 'General Timetable') return raw;
  var who = '';
  if (/pulki/i.test(org) || /\bpulki\b/i.test(raw)) who = 'Pulki';
  else if (/poorvi/i.test(org) || /poorvi/i.test(raw)) who = 'Zuperscore';
  else if (/krati/i.test(org) || /zuperscore/i.test(org) || /zuperscore/i.test(raw)) who = 'Zuperscore';
  else if (/tisha/i.test(org) || /varghese/i.test(org) || /phoenix/i.test(org) || /phoenix/i.test(raw)) who = 'Phoenix';
  var short = raw.replace(/\s*[-–—]\s*Ishaan\s*$/i, '').trim();
  if (who) return 'SAT class · ' + who + (short ? ' (' + short + ')' : '');
  return 'SAT class · ' + (short || raw || 'booked class');
}

function classifyGeneral_(ev) {
  if (isCancelled_(ev) || isTransparent_(ev)) return null;
  var title = titleOf_(ev);
  if (!title || isDraftStudy_(title) || isExcluded_(title)) return null;
  var start = eventLocalParts_(ev.start);
  var end = eventLocalParts_(ev.end);
  if (!start || !end || start.allDay) return null;
  var base = { id: ev.id || (title + start.date + start.hm), date: start.date, start: start.hm, end: end.hm, day: dowShort_(start.date), sourceTitle: title };
  if (isSchoolPeriod_(title)) {
    return Object.assign({ kind: 'school-period', title: title, source: 'General Timetable' }, base);
  }
  if (isZuperscoreTitle_(title)) {
    return Object.assign({
      kind: 'sat_class', title: title, minutes: minutesBetween_(start.hm, end.hm),
      satTutor: true, source: 'General Timetable'
    }, base);
  }
  if (isTutor_(title)) {
    return Object.assign({
      kind: 'tutor', title: title, minutes: minutesBetween_(start.hm, end.hm),
      satTutor: false, source: 'General Timetable'
    }, base);
  }
  return null;
}

function classifyStudy_(ev) {
  if (isCancelled_(ev) || isTransparent_(ev)) return null;
  var title = titleOf_(ev);
  if (!title || isDraftStudy_(title) || isExcluded_(title) || !isStudySatClass_(ev)) return null;
  var start = eventLocalParts_(ev.start);
  var end = eventLocalParts_(ev.end);
  if (!start || !end || start.allDay) return null;
  return {
    id: ev.id || title,
    title: satClassTitle_(ev, 'Study'),
    date: start.date,
    day: dowShort_(start.date),
    start: start.hm,
    end: end.hm,
    minutes: minutesBetween_(start.hm, end.hm),
    kind: 'sat_class',
    satTutor: true,
    source: 'Study',
    sourceTitle: title
  };
}

function collapseSchool_(periods, date) {
  if (!periods.length) return null;
  var start = periods[0].start;
  var end = periods[0].end;
  periods.forEach(function (p) {
    if (p.start < start) start = p.start;
    if (p.end > end) end = p.end;
  });
  return {
    id: 'school-' + date,
    title: 'School',
    date: date,
    day: dowShort_(date),
    start: start,
    end: end,
    minutes: minutesBetween_(start, end),
    kind: 'school',
    satTutor: false,
    source: 'General Timetable',
    sourceTitle: 'School (collapsed periods)'
  };
}

function fridaySocial_(date) {
  return {
    id: 'social-' + date,
    title: 'Social time',
    date: date,
    day: 'Fri',
    start: FRIDAY_SOCIAL_START,
    end: FRIDAY_SOCIAL_END,
    minutes: minutesBetween_(FRIDAY_SOCIAL_START, FRIDAY_SOCIAL_END),
    kind: 'social',
    satTutor: false,
    source: 'rule',
    sourceTitle: 'Fri social after early finish'
  };
}

function dedupeLocks_(locks) {
  var out = [];
  locks.forEach(function (lock) {
    var hit = -1;
    var i;
    for (i = 0; i < out.length; i++) {
      if (out[i].date === lock.date && out[i].kind === lock.kind &&
          rangesOverlap_(out[i].start, out[i].end, lock.start, lock.end)) {
        hit = i;
        break;
      }
    }
    if (hit === -1) {
      out.push(lock);
      return;
    }
    var existing = out[hit];
    if (lock.source === 'General Timetable' && existing.source !== 'General Timetable') out[hit] = lock;
  });
  return out;
}

function buildLiveLocksDoc_(weekStart) {
  weekStart = startOfWeekMonday_(weekStart);
  var weekEnd = addDaysISO_(weekStart, 6);
  var classified = [];
  listCalEvents_(GENERAL_TIMETABLE_ID, weekStart).forEach(function (ev) {
    var row = classifyGeneral_(ev);
    if (row) classified.push(row);
  });
  listCalEvents_(STUDY_CALENDAR_ID, weekStart).forEach(function (ev) {
    var row = classifyStudy_(ev);
    if (row) classified.push(row);
  });
  var locks = [];
  var i;
  for (i = 0; i < 7; i++) {
    var date = addDaysISO_(weekStart, i);
    var dayItems = classified.filter(function (x) { return x.date === date; });
    var periods = dayItems.filter(function (x) { return x.kind === 'school-period'; });
    var rest = dayItems.filter(function (x) { return x.kind !== 'school-period'; });
    var school = collapseSchool_(periods, date);
    if (school) locks.push(school);
    rest.forEach(function (item) { locks.push(item); });
    if (dowShort_(date) === 'Fri') {
      var has = locks.some(function (L) {
        return L.date === date && L.kind === 'social' && L.start === FRIDAY_SOCIAL_START && L.end === FRIDAY_SOCIAL_END;
      });
      if (!has) locks.push(fridaySocial_(date));
    }
  }
  locks = dedupeLocks_(locks);
  locks.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
    return String(a.end).localeCompare(String(b.end));
  });
  return {
    weekStart: weekStart,
    weekEnd: weekEnd,
    timezone: TZ,
    fetchedAt: nowHktIso_(),
    sources: ['General Timetable (Google Calendar)', 'Study calendar (SAT classes)'],
    exclusions: EXCLUSIONS.slice(),
    notes: 'School periods collapsed per day. DRAFT study events and other transparent events ignored. SAT booked classes from the Study calendar (and Zuperscore on General Timetable) included as sat_class locks. Friday social 13:05–16:00 is a standing rule.',
    locks: locks
  };
}

/* ---------------- Publish: GitHub + deed.page ---------------- */

function publishAll_(opts) {
  var changes = {};
  if (opts.shared && opts.weekStart) {
    changes['choices/' + opts.weekStart + '.json'] = JSON.stringify(opts.shared, null, 2) + '\n';
  }
  if (opts.audit) {
    var existingAudit = fetchPublicFile_('audit/choices-log.jsonl') || '';
    if (existingAudit && existingAudit.slice(-1) !== '\n') existingAudit += '\n';
    changes['audit/choices-log.jsonl'] = existingAudit + JSON.stringify(opts.audit) + '\n';
  }
  if (opts.progress) {
    changes['progress.json'] = JSON.stringify(opts.progress, null, 2) + '\n';
  }
  var latestWeek = null;
  if (opts.locksDocs) {
    Object.keys(opts.locksDocs).forEach(function (ws) {
      var doc = opts.locksDocs[ws];
      if (!doc) return;
      changes['locks/' + ws + '.json'] = JSON.stringify(doc, null, 2) + '\n';
      latestWeek = latestWeek || opts.weekStart || ws;
    });
    if (latestWeek && opts.locksDocs[latestWeek]) {
      changes['locks/latest.json'] = JSON.stringify({
        weekStart: latestWeek,
        path: 'locks/' + latestWeek + '.json',
        fetchedAt: opts.locksDocs[latestWeek].fetchedAt || nowHktIso_()
      }, null, 2) + '\n';
    }
  }
  if (!Object.keys(changes).length) throw new Error('Nothing to publish.');

  var githubSha = githubCommitFiles_(changes, opts.message || 'Week picker sync');
  var deed = deedRepublish_(changes);
  return {
    githubSha: githubSha,
    deedVersion: (deed && (deed.version || deed.current_version)) || null
  };
}

function fetchPublicFile_(path) {
  var url = DEED_HOST + '/' + String(path).replace(/^\//, '') + '?t=' + Date.now();
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  var code = res.getResponseCode();
  if (code === 404) return null;
  if (code < 200 || code >= 300) return null;
  return res.getContentText();
}

function githubHeaders_() {
  return {
    'Authorization': 'Bearer ' + requireProp_('GITHUB_TOKEN'),
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'ishaan-week-picker-sync',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

function githubFetch_(method, url, body) {
  var params = {
    method: method,
    headers: githubHeaders_(),
    muteHttpExceptions: true,
    followRedirects: true
  };
  if (body != null) {
    params.contentType = 'application/json';
    params.payload = JSON.stringify(body);
  }
  var res = UrlFetchApp.fetch(url, params);
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code < 200 || code >= 300) {
    // Never include request headers or tokens in the thrown message.
    throw new Error('GitHub ' + method + ' failed (' + code + ').');
  }
  return text ? JSON.parse(text) : {};
}

function githubCommitFiles_(changes, message) {
  var base = 'https://api.github.com/repos/' + GITHUB_REPO;
  var ref = githubFetch_('get', base + '/git/ref/heads/' + GITHUB_BRANCH);
  var commitSha = ref.object.sha;
  var commit = githubFetch_('get', base + '/git/commits/' + commitSha);
  var treeItems = [];
  Object.keys(changes).forEach(function (path) {
    var blob = githubFetch_('post', base + '/git/blobs', {
      content: Utilities.base64Encode(changes[path], Utilities.Charset.UTF_8),
      encoding: 'base64'
    });
    treeItems.push({ path: path, mode: '100644', type: 'blob', sha: blob.sha });
  });
  var tree = githubFetch_('post', base + '/git/trees', {
    base_tree: commit.tree.sha,
    tree: treeItems
  });
  var newCommit = githubFetch_('post', base + '/git/commits', {
    message: message,
    tree: tree.sha,
    parents: [commitSha]
  });
  githubFetch_('patch', base + '/git/refs/heads/' + GITHUB_BRANCH, { sha: newCommit.sha });
  return newCommit.sha;
}

function deedHeaders_(extra) {
  var h = {
    'Authorization': 'Bearer ' + requireProp_('DEED_TOKEN'),
    'X-Client': 'ishaan-week-picker-sync',
    'Accept': 'application/json'
  };
  if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
  return h;
}

function deedFetch_(method, url, body, extraHeaders) {
  var params = {
    method: method,
    headers: deedHeaders_(extraHeaders),
    muteHttpExceptions: true,
    followRedirects: true
  };
  if (body != null) {
    params.contentType = 'application/json';
    params.payload = JSON.stringify(body);
  }
  var res = UrlFetchApp.fetch(url, params);
  var code = res.getResponseCode();
  var text = res.getContentText();
  var parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch (e) { parsed = {}; }
  if (code < 200 || code >= 300) {
    var err = (parsed && (parsed.message || parsed.error || parsed.code)) || ('HTTP ' + code);
    throw new Error('deed.page publish failed (' + err + ').');
  }
  return parsed;
}

function extractManifestPaths_(manifest) {
  var paths = [];
  if (!manifest) return paths;
  var files = manifest.files || manifest.entries || manifest.tree || [];
  if (Array.isArray(files)) {
    files.forEach(function (f) {
      var p = (typeof f === 'string') ? f : (f.path || f.name || f.file);
      if (p) paths.push(String(p).replace(/^\.\//, ''));
    });
  } else if (files && typeof files === 'object') {
    Object.keys(files).forEach(function (p) { paths.push(p); });
  }
  return paths;
}

function currentDeedVersion_() {
  try {
    var site = deedFetch_('get', DEED_API + '/v1/sites/' + DEED_SLUG);
    return site.version || site.current_version || site.live_version || null;
  } catch (e) {
    try {
      var man = deedFetch_('get', DEED_API + '/v1/sites/' + DEED_SLUG + '/manifest');
      return man.version || (man.site && man.site.version) || null;
    } catch (e2) {
      return null;
    }
  }
}

function listDeedPaths_() {
  var paths = KNOWN_PUBLIC_FILES.slice();
  try {
    var man = deedFetch_('get', DEED_API + '/v1/sites/' + DEED_SLUG + '/manifest');
    extractManifestPaths_(man).forEach(function (p) {
      if (paths.indexOf(p) === -1) paths.push(p);
    });
  } catch (e) {
    // Fall back to the known tree plus whatever is already in the GitHub repo listing.
  }
  // Also pick up any locks/*.json and choices/*.json already on the live host
  // by querying GitHub's tree so a partial map cannot drop them.
  try {
    var tree = githubFetch_('get', 'https://api.github.com/repos/' + GITHUB_REPO + '/git/trees/' + GITHUB_BRANCH + '?recursive=1');
    (tree.tree || []).forEach(function (item) {
      if (item.type === 'blob' && item.path && paths.indexOf(item.path) === -1) {
        if (/\.(html|md|json|jsonl|mjs|js)$/i.test(item.path) && item.path.indexOf('apps-script/') !== 0) {
          paths.push(item.path);
        }
      }
    });
  } catch (e2) {}
  return paths;
}

function deedRepublish_(changes) {
  var version = currentDeedVersion_();
  var paths = listDeedPaths_();
  Object.keys(changes).forEach(function (p) {
    if (paths.indexOf(p) === -1) paths.push(p);
  });
  var fileMap = {};
  paths.forEach(function (p) {
    if (Object.prototype.hasOwnProperty.call(changes, p)) {
      fileMap[p] = changes[p];
      return;
    }
    var body = fetchPublicFile_(p);
    if (body != null) fileMap[p] = body;
  });
  if (!fileMap['index.html']) {
    throw new Error('Refusing to publish to deed.page: index.html is missing from the complete file map.');
  }
  var headers = {};
  if (version) {
    var v = String(version);
    if (v.charAt(0) !== '"') v = '"' + v.replace(/"/g, '') + '"';
    headers['If-Match'] = v;
    headers['X-Expected-Version'] = String(version).replace(/"/g, '');
  }
  return deedFetch_('post', DEED_API + '/v1/sites?slug=' + encodeURIComponent(DEED_SLUG) + '&ref=ishaan-week-picker-sync', {
    slug: DEED_SLUG,
    files: fileMap
  }, headers);
}

/**
 * Deploy helper. Called only by deploy.sh via clasp run.
 * Payload keys are written to Script Properties. Do not log the values.
 */
function installPropertiesFromPayload_(payload) {
  payload = payload || {};
  var allowed = ['FAMILY_SYNC_KEY', 'DEED_TOKEN', 'GITHUB_TOKEN'];
  var props = PropertiesService.getScriptProperties();
  var i, key, n = 0;
  for (i = 0; i < allowed.length; i++) {
    key = allowed[i];
    if (payload[key]) {
      props.setProperty(key, String(payload[key]));
      n += 1;
    }
  }
  return { ok: true, set: n };
}
