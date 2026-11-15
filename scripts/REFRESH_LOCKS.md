# Refresh calendar locks

The builder at `scripts/build-locks.mjs` classifies General Timetable and Study
calendar events into `locks/YYYY-MM-DD.json` (and `locks/latest.json`).

After the Apps Script sync service is deployed, **Send to calendar** and the
optional `scheduledRefreshLocks` trigger refresh locks and publish them to both
hosts. Until then, run the builder locally (this pass already did, for
Mon 9 Nov 2026 through Mon 8 Mar 2027).

## Sources
- **General Timetable** calendar id: `b6d79ffabd2be1218259fa817d90e07a59bb500ca10be63acc3e96a4ee00c36b@group.calendar.google.com`
- **Study** (SAT classes): `ishaanvhemrajani@gmail.com` — reader only, never a write target.

## Steps
1. `list_events` on both calendars for Mon 00:00 → next Mon 00:00 Asia/Hong_Kong (or a wider window, then split by week).
2. Write the events as JSON (shape: `{ events: [ … ] }` or a bare array) and run:

       node scripts/build-locks.mjs \
         --general /tmp/gt-events.json \
         --study /tmp/study-events.json \
         --from YYYY-MM-DD \
         --to YYYY-MM-DD \
         --latest YYYY-MM-DD \
         --out-dir locks

3. Classify (implemented in the builder and in Apps Script):
   - school period titles (`12WW`, `12EN…`) → collapse per day to one `school` lock
   - Ghosh / English / History / Math Tutor → `tutor`
   - ALWAYS add Friday Social 13:05–16:00 even if it is not on the calendar
   - Study calendar Zoom/SAT sessions (Zuperscore, Phoenix, “60 mins - Ishaan”, Pulki, etc.) → `sat_class` with `satTutor: true`
   - Zuperscore on General Timetable is also `sat_class`
4. Skip: Bhavan, Dr OK, any `DRAFT ·` study event, and other transparent events. Do not invent events that are not on the calendars, except the standing Friday social.
5. After deploy, Send to calendar (or a scheduled trigger) publishes the files to GitHub Pages **and** deed.page so every browser fetch sees fresh locks on load.

## Conflict UX
The picker flags study picks that overlap locks — especially **SAT booked classes** vs IB/SAT/Light/Free slots.
