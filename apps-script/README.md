# Ishaan week picker · Apps Script sync backend

This web app is the write path for **Send to calendar**. The public planner
never holds the family sync key, the deed token, or a GitHub token.

**Do not deploy from a casual agent pass.** After `clasp login` (Vikram, once),
run `./deploy.sh` from this folder. The script pushes the project, sets Script
Properties from local secret files, deploys the web app (execute as you, access
Anyone), and writes the public web-app URL into `../index.html` as `SYNC_API_URL`.

Live planner: https://ishaan-week-picker.deed.page/  
GitHub Pages (must stay in sync): https://vikramhemrajani.github.io/ishaan-week-picker/

## What it does

| Action | Family key | Effect |
|--------|------------|--------|
| `syncWeek` | required | Resync General Timetable **DRAFT** events for that week only, then publish the shared plan, audit line, topic progress, and refreshed locks to **both** GitHub and deed.page. |
| `writeProgress` | required | Publish `progress.json` only (no calendar rewrite). |
| `refreshLocks` | required | Rebuild locks from General Timetable + Study and publish them. |
| `getLocks` | not required | Return a live locks document for one week (public data). Used as a JSONP fallback when `locks/{week}.json` is missing. |

Calendar writes target **General Timetable** only. The Study calendar is reader-only and must never be a write target. Deletes are limited to events whose description contains `[ISHAAN_WEEK_PICKER]` **and** `week:YYYY-MM-DD` for the requested week.

## Secrets (never commit, never log, never put in `index.html`)

Set these as **Script Properties** (the deploy script does this for you):

- `FAMILY_SYNC_KEY` — from `~/.config/ishaan-week-picker/family-sync-key` (mode 600)
- `DEED_TOKEN` — from `~/.config/deed-page/token` (mode 600)
- `GITHUB_TOKEN` — an already-available `gh` token with `repo` scope (`gh auth token` at deploy time). Do not mint a new PAT.

Ishaan enters the family key once in the planner. It is stored only in that browser, as `localStorage['ishaan-family-sync-key']`.

## Popup / postMessage flow

Apps Script `doPost` does not send CORS headers, so the planner does not `fetch()` this URL for writes.

1. **Send to calendar** (or **Save topic progress**) opens a small popup at the web-app URL, passing `clientOrigin`.
2. The popup (`SyncPopup.html`) posts `{type:'ishaan-week-picker-ready'}`.
3. The opener posts `{type:'ishaan-week-picker-request', payload:{action, familyKey, ...}}`.
4. The popup calls `google.script.run.handleClientRequest(payload)`.
5. The popup posts `{type:'ishaan-week-picker-result', payload}` and closes.
6. The planner shows a durable **Synced at …** status (Hong Kong time) only when the result has `ok: true` and includes both calendar counts (for `syncWeek`) and publish identifiers.

Read-only `getLocks` uses JSONP (`?action=getLocks&weekStart=YYYY-MM-DD&callback=…`) so the planner can load live locks without a popup.

## Exact clasp steps (also what `deploy.sh` runs)

Prerequisites: Node.js, and this repo checked out.

```bash
npm install -g @google/clasp
clasp login          # once, as Vikram, in a browser you control
cd apps-script
```

If this project has not been created yet:

```bash
clasp create --title "Ishaan week picker sync" --type webapp --rootDir .
# This writes .clasp.json with the script id. Commit .clasp.json (it is not a secret).
```

If `.clasp.json` already has a `scriptId`, skip `clasp create` and use `clasp push`.

In the Apps Script editor (or let `deploy.sh` remind you):

1. Enable the **Google Calendar API** advanced service (`Calendar`, v3). `appsscript.json` already declares it.
2. Confirm the Cloud project can use Calendar + external requests. First `clasp push` / deploy will ask you to authorise scopes:
   - `https://www.googleapis.com/auth/calendar`
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/script.external_request`
3. Deploy as a web app: **Execute as: Me**. **Who has access: Anyone**.

Or, from this folder after login:

```bash
chmod +x deploy.sh
./deploy.sh
```

`deploy.sh` will:

1. Abort if `~/.clasprc.json` is missing (it will not run `clasp login`).
2. `clasp push` this folder.
3. Set Script Properties from the local secret files above, without printing their values.
4. `clasp deploy` as a web app (execute as you, access anyone).
5. Patch `SYNC_API_URL` in `../index.html` (placeholder becomes the `/macros/s/…/exec` URL).
6. Print the remaining **human** steps: authorise scopes if this is the first deploy, then publish `index.html` to deed.page **and** push `main` so GitHub Pages stays in sync. The script itself does not publish or `git push`.

Optional: in the Apps Script editor, add a time-driven trigger for `scheduledRefreshLocks` (for example weekly on Sunday afternoon Hong Kong time) so plan-ahead lock files stay fresh.

## After deploy

1. Hard-refresh https://ishaan-week-picker.deed.page/ once the new `index.html` is published.
2. Enter the family key when the planner asks (once per browser).
3. **Send to calendar** should show **Synced at …** rather than a copy-paste toast.
4. If the web-app URL is still the empty placeholder, the button tells you honestly that it cannot write yet, and offers the payload as a last-resort fallback.

## Safety

- Never put tokens or the family key in this folder, in `index.html`, or in chat.
- Never use the Study calendar (`ishaanvhemrajani@gmail.com`) as a write target.
- Do not delete calendar events unless they carry both `[ISHAAN_WEEK_PICKER]` and the matching `week:` tag.
- deed republish always sends a complete file map and refuses to go ahead if `index.html` would be missing. It sends `If-Match` / `X-Expected-Version` when the live version is known.
