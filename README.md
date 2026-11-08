# Ishaan · IB Tracker

Static site with **Week** and **Topics** tabs (British English). Live: https://vikramhemrajani.github.io/ishaan-week-picker/

- **Week** — dated slot picker with IB/SAT balance meters (targets 12h IB / 3h SAT), Sync / Copy / Reset / Print.
- **Topics** — traffic-light overview + coverage map from verified syllabus rows only (no invented curriculum). Status cycle: Not started → Seen in class → Reviewed once → Exam-ready. Progress is stored in `localStorage`; **Copy progress** dumps `SYNC_IB_PROGRESS` JSON to paste to Dad’s Assistant.
- Picking a matching IB topic in Week auto-bumps that topic to at least **Reviewed once**.
- Data: `topics.json` (export from Excel), `progress.json` (defaults). Excel remains the export/backup source of truth for curriculum rows.
