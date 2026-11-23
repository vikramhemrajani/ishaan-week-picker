# Ishaan · IB Tracker

Static site with **Week** and **Topics** tabs (British English).

- Live: https://ishaan-week-picker.deed.page/
- GitHub Pages (kept in sync): https://vikramhemrajani.github.io/ishaan-week-picker/

- **Week** — dated slot picker with IB/SAT balance meters (targets 12h IB / 3h SAT), Send to calendar / Copy plan text / Load shared plan / Clear my picks / Print, and **Fill free slots from Due**.
- **Topics** — traffic-light overview + coverage map + **Due this week** strip (spaced revisits: Seen 3d · Reviewed 7d · Exam-ready 21d). Status cycle: Not started → Seen in class → Reviewed once → Exam-ready. Progress is saved on the family plan store as well as this device. Another browser loads the newer copy and does not lose a later edit made here.
- Coverage subjects: **English A Lit, Maths AA, Physics, Spanish B, History, ToK, Thrive**. **Music** topic lists are still deferred pending Ishaan (books / school pathways unknown); Week still offers a Music chip with Other / type… only. Four History RS9 rows are flagged TBC until the Latin American country is named.
- Picking a matching IB topic in Week auto-bumps that topic to at least **Reviewed once**.
- Data: `topics.json`, `progress.json`. Excel remains export/backup for curriculum rows.

- **Dense dashboard UX** — wider shell (~1320px), sticky Week/Topics tabs, balance rail + multi-column day/topic grids on desktop; howto/notice collapsed by default.

- **Shared plan (cross-browser)** — **Save family plan** (and edits, once this browser has the family code) writes the week and topic progress to a central store. Any other browser, including one with empty localStorage, loads that save when it opens the same week. No chat paste is required. `choices/YYYY-MM-DD.json` is only the hosted seed used before the first family save. The family code is entered once per browser and is never stored in the public page. Setup: `store/README.md`. **Send to calendar** still writes General Timetable drafts when Apps Script is configured (`SYNC.md`). A copyable `SYNC_WEEK` payload remains a fallback for calendar drafts, or if the store cannot be reached.

- **Week navigator** — prev/next, jump list, and date picker for planning ahead. With no `#week=` hash, Sunday in Asia/Hong_Kong opens next Monday’s week (the week being planned); otherwise the page opens the week containing today. The **This week** button goes to that planning week. Live calendar locks load from `locks/YYYY-MM-DD.json` (or the sync service if the file is missing). Choices: `localStorage` key `ishaan-week-YYYY-MM-DD`.

- **Fill Free from Due** — one-tap (and Free-slot Due chips) seeds empty Free slots from Topics spaced revisits (Seen 3d · Reviewed 7d · Exam-ready 21d). Never overwrites IB/SAT/Light; respects 12h IB and reserves room for 3h SAT.
- **Exam countdown** — balance rail shows days to SAT **6 Mar 2027**, US applications (~Oct 2027), and typical IB May 2028, plus this week’s IB/SAT hours vs targets.
- **Reminders** — collapsed note: calendar alerts + iMessage once Messages is connected; Send to calendar is the path that writes General Timetable drafts.

## Live calendar locks

See `locks/`, `scripts/REFRESH_LOCKS.md`, and `SYNC.md` — page load fetches the latest tutor/school/SAT-class locks; conflicts with study picks are highlighted. Friday social 13:05–16:00 is standing.
