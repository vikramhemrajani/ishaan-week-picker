# Ishaan · IB Tracker

Static site with **Week** and **Topics** tabs (British English). Live: https://vikramhemrajani.github.io/ishaan-week-picker/

- **Week** — dated slot picker with IB/SAT balance meters (targets 12h IB / 3h SAT), Sync / Copy / Reset / Print, and **Fill Free from Due**.
- **Topics** — traffic-light overview + coverage map + **Due this week** strip (spaced revisits: Seen 3d · Reviewed 7d · Exam-ready 21d). Status cycle: Not started → Seen in class → Reviewed once → Exam-ready. Progress in `localStorage`; **Copy progress** dumps `SYNC_IB_PROGRESS` JSON.
- Coverage subjects: **Maths AA, Physics, Spanish B, ToK, Thrive**. **English / History / Music** topic lists are deferred pending Ishaan (books / school pathways unknown); Week still offers those subject chips with Other / type… only.
- Picking a matching IB topic in Week auto-bumps that topic to at least **Reviewed once**.
- Data: `topics.json`, `progress.json`. Excel remains export/backup for curriculum rows.

- **Dense dashboard UX** — wider shell (~1320px), sticky Week/Topics tabs, balance rail + multi-column day/topic grids on desktop; howto/notice collapsed by default.

- **Week navigator** — prev/next, jump list, and date picker for planning ahead (± weeks around the published skeleton). The published week keeps **live calendar locks**; other weeks use a **typical-week template** (same school/social/open skeleton + recurring tutors, dates shifted). Choices: `localStorage` key `ishaan-week-YYYY-MM-DD`. Sync paste still starts with `SYNC_WEEK <weekStart>`.

- **Fill Free from Due** — one-tap (and Free-slot Due chips) seeds empty Free slots from Topics spaced revisits (Seen 3d · Reviewed 7d · Exam-ready 21d). Never overwrites IB/SAT/Light; respects 12h IB and reserves room for 3h SAT.
- **Exam countdown** — balance rail shows days to SAT **6 Mar 2027**, US applications (~Oct 2027), and typical IB May 2028, plus this week’s IB/SAT hours vs targets.
- **Reminders** — collapsed note: calendar alerts + iMessage once Messages is connected; Sync remains the calendar path.
- **Sync paste** — see `/workspace/ishaan-study/SYNC_PASTE.md` (and below): `SYNC_WEEK` + `CHOICES_JSON` for General Timetable DRAFT apply by Dad’s Assistant.
