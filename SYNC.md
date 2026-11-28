# Sync — Ishaan week picker → family plan + calendar

Live: https://ishaan-week-picker.deed.page/  
GitHub Pages (kept in sync): https://vikramhemrajani.github.io/ishaan-week-picker/

## Family plan store (how another browser sees a save)

The static hosts cannot accept a write from the browser, so `choices/*.json` on deed.page stayed a Sunday seed while Ishaan’s finished week lived only in that browser’s localStorage. Pasting `SYNC_WEEK` was the only way to move it.

The family plan store is a Cloudflare Worker (`store/`). **Save family plan**, and ordinary edits, `PUT` the week and topic progress there immediately. No code is asked for. A second browser `GET`s the same week on load, on focus, and about every 20 seconds. Empty localStorage and a hard refresh still load the latest save. Writes are open on purpose: anyone who can reach the worker address can overwrite a week. Browser writes are still limited to the family sites by the `Origin` check.

`choices/YYYY-MM-DD.json` and `progress.json` remain the seed the page uses when the store has no document yet, or when the store cannot be reached. They are no longer the only shared copy.

Vikram’s one-time setup, secret names, and the deed.page republish command are in `store/README.md`. Until `STORE_API_URL` in `index.html` is the deployed worker URL and both hosts are republished, the page says so and does not pretend a save was shared.

## Calendar drafts

**Send to calendar** still saves the family plan first, with no code. It writes this week’s non-Free picks to **General Timetable** as DRAFT events only when the Apps Script web app is configured. That service still checks its own server property. The page no longer collects or sends a client secret, so that popup will not be authorised until Apps Script is updated separately. Sharing the plan does not depend on it.

The public page never holds a deed token or a GitHub token, and it does not collect or store a client secret. Calendar drafts, when `SYNC_API_URL` is set, still go through a Google Apps Script web app (execute as Vikram, access Anyone) via a small `script.google.com` popup and `postMessage`. That service still checks its own server property. See `apps-script/README.md`.

Until that web-app URL is written into `SYNC_API_URL` (by `apps-script/deploy.sh` after `clasp login`), the button tells you honestly that it cannot write yet and offers a copyable fallback payload. Do not treat that fallback as a successful sync.

## What Send to calendar sends

The backend receives:

- `weekStart` — Monday of the week (`CONFIG.weekStart`, Asia/Hong_Kong)
- `choices` — **non-Free** open-slot picks (IB / SAT / Light) for calendar DRAFT apply
- `sharedPlan` — full shared document (all open slots including Free) written to `choices/YYYY-MM-DD.json`. `source` is `Send to calendar`
- `auditEntry` — one append-only line for `audit/choices-log.jsonl`
- `progress` — the current topic progress document, written to `progress.json`
- `familyKey` — checked with a constant-time compare against Script Properties

**Save topic progress** on the Topics tab uses the same backend (`writeProgress`) and does not rewrite calendar drafts.

### Apply rules

**Calendar** (General Timetable only — never the Study calendar)
1. Scope deletes to **this** `weekStart` only.
2. Remove existing events whose description contains `[ISHAAN_WEEK_PICKER]` **and** `week:YYYY-MM-DD` for that week.
3. Create new DRAFT events from each non-Free choice.
4. Do **not** invent or move locked tutors / school / social.
5. Timezone: **Asia/Hong_Kong**. Titles: `DRAFT · Study IB · {subject} — {topic}` / `DRAFT · SAT · {area}` / `DRAFT · Light`. Description includes the picker link `https://ishaan-week-picker.deed.page/#week=YYYY-MM-DD`. colourId IB 9, SAT 6, Light 2. transparency transparent. popup reminder 10 minutes. `sendUpdates: none`. No attendees. Free slots are not written.

**Shared plan (every successful Send)**
1. Write `choices/<weekStart>.json` = pretty-printed shared plan.
2. Append one new line to `audit/choices-log.jsonl` (create the file if missing; never rewrite history).
3. Write `progress.json`.
4. Refresh locks for the target week (and nearby plan-ahead weeks) when the calendars can be read, and include those files.
5. Update **both** `vikramhemrajani/ishaan-week-picker` (GitHub Pages) and https://ishaan-week-picker.deed.page/ with a complete file map (`If-Match` on deed). A publish is refused if `index.html` would be missing.
6. The planner shows a durable **Synced at …** status (Hong Kong time) only when the backend confirms the calendar write **and** publish to both hosts.

### Browser behaviour

- On load, and about every 20 seconds while the tab is open, the page reads the family plan store for this week. That copy wins over `choices/<weekStart>.json` and over a localStorage copy of the old seed.
- If the store has nothing yet, a missing or blank local week still loads `choices/<weekStart>.json`.
- A private edit on this device is kept and saved automatically, unless another device has a newer revision — then the status line asks you to **Load shared plan** or **Save family plan**.
- Default landing (no `#week=` hash), in Asia/Hong_Kong: if today is Sunday, open next Monday’s week (the week being planned); otherwise open the week containing today. The hash still wins. The **This week** button goes to that planning week. The jump-week list is ± weeks around it, not a baked 9–15 Nov skeleton.

### Topic progress across devices

Progress is stored locally as `ishaan-ib-progress-v1` and on the family plan store at `PUT /v1/progress`. On boot and when you open the Topics tab, the page merges the store and hosted `progress.json`. A newer per-topic `lastTouched` wins, so a later edit on this device is not overwritten by an older copy. **Save topic progress** writes the store immediately.

### Fallback payload (only if the button cannot write)

The copyable payload still exists as a last resort:

```
SYNC_WEEK YYYY-MM-DD
CHOICES_JSON:[{...},{...},...]
SHARED_PLAN_JSON:{...}
AUDIT_ENTRY_JSON:{...}
PROGRESS_JSON:{...}
PUBLISH_HINT: Fallback only — …
```

**Copy plan text** remains an optional notes dump (it includes Free rows). **Copy topic progress** is also a fallback, not the normal publish path.

## Calendar locks (`locks/YYYY-MM-DD.json`)

School, tutors (Ghosh / English / History / Maths), Friday social, and **SAT booked classes** are published as a fresh locks file — not only baked into `index.html`.

### On every page load
1. The Week tab fetches `locks/<weekStart>.json` (cache-busted).
2. If that file is missing or stale, and `SYNC_API_URL` is configured, the page asks the backend `getLocks` action (JSONP, no family key) for a live document.
3. Locked blocks are rebuilt from that file (school collapsed per day; tutors; `sat_class` from the Study calendar and Zuperscore on General Timetable).
4. Friday social 13:05–16:00 is applied even when a file is missing.
5. Open study slots that overlap a lock are removed; any remaining pick/lock overlap shows a **conflict** badge + list (SAT classes highlighted).
6. If neither a file nor the backend is available, the page stays on the date-shifted skeleton and says so honestly.

### Refresh
The local builder is `scripts/build-locks.mjs` (notes in `scripts/REFRESH_LOCKS.md`). After deploy, Send to calendar and an optional scheduled trigger refresh locks from the live calendars and publish them with the same complete-tree rules.

Schema (per lock): `id`, `title`, `date`, `day`, `start`, `end`, `minutes`, `kind` (`school`|`tutor`|`social`|`sat_class`), `satTutor`, `source`, `sourceTitle`.  
Top-level: `weekStart`, `weekEnd`, `timezone`, `fetchedAt`, `sources`, `exclusions`, `locks`.
