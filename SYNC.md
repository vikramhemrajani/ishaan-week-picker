# Sync paste format — Ishaan week picker → calendar + shared plan

The Week tab **Sync to calendar** button copies a plain-text payload for Dad’s Assistant. The static site (**GitHub Pages / deed**) **cannot** write itself from the browser. Sync is how choices become shared across browsers and how DRAFT study lands on **General Timetable**.

## Payload (exact shape)

```
SYNC_WEEK YYYY-MM-DD
CHOICES_JSON:[{...},{...},...]
SHARED_PLAN_JSON:{...}
AUDIT_ENTRY_JSON:{...}
PUBLISH_HINT: Write choices/YYYY-MM-DD.json from SHARED_PLAN_JSON; append AUDIT_ENTRY_JSON to audit/choices-log.jsonl; push gh-pages + deed republish. Site cannot self-write.
```

- `SYNC_WEEK` — Monday of the week (`CONFIG.weekStart`, Asia/Hong_Kong).
- `CHOICES_JSON` — array of **non-Free** open-slot picks only (IB / SAT / Light) for calendar DRAFT apply.
- `SHARED_PLAN_JSON` — full shared document (all open slots including Free) to write at `choices/YYYY-MM-DD.json`.
- `AUDIT_ENTRY_JSON` — one append-only line for `audit/choices-log.jsonl` (timestamp, weekStart, source, counts, hours).

### SHARED_PLAN_JSON fields

| Field | Meaning |
|-------|---------|
| `weekStart` | Monday `YYYY-MM-DD` |
| `updatedAt` | ISO timestamp (prefer Asia/Hong_Kong offset) |
| `source` | e.g. `Sync paste` |
| `timezone` | `Asia/Hong_Kong` |
| `totals` / `counts` | IB · SAT · Free · Light hours and slot counts |
| `choices` | Full open-slot array (same row shape as Copy my choices) |

### Apply rules (for parent / Assistant)

**Calendar**
1. Scope deletes to **this** `SYNC_WEEK` only.
2. Remove existing **DRAFT** study entries for that week on General Timetable.
3. Create new DRAFT events from each `CHOICES_JSON` row.
4. Do **not** invent or move locked tutors / school / social.
5. Timezone: **Asia/Hong_Kong**.

**Shared plan (every Sync — always)**
1. Write `choices/<SYNC_WEEK>.json` = pretty-printed `SHARED_PLAN_JSON`.
2. Append `AUDIT_ENTRY_JSON` as one new line to `audit/choices-log.jsonl` (create file if missing; never rewrite history).
3. Commit + push `vikramhemrajani/ishaan-week-picker` (GitHub Pages) and republish https://ishaan-week-picker.deed.page/.
4. Tell Vikram to hard-refresh, or use **Reset to shared plan** if this browser still shows an old blank localStorage week.

### Browser behaviour

- On load: if this week’s `localStorage` is missing or all Free → auto-load `choices/<weekStart>.json`.
- Local edits stay until Sync (Assistant republishes) or **Reset to shared plan**.
- Status strip shows last shared publish time from the file / audit log.

### Related pastes

- **Copy my choices** — human-readable week dump ending with `CHOICES_JSON:` (includes Free rows).
- **Copy progress** (Topics) — `SYNC_IB_PROGRESS` + `PROGRESS_JSON:…` (separate from calendar / shared plan).

Live: https://vikramhemrajani.github.io/ishaan-week-picker/ · fallback https://ishaan-week-picker.deed.page/
