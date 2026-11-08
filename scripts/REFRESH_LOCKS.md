# Refresh calendar locks

Dad’s Assistant (or a local agent with Google Calendar MCP) should refresh locks whenever publishing the week picker.

## Sources
- **General Timetable** calendar id: `b6d79ffabd2be1218259fa817d90e07a59bb500ca10be63acc3e96a4ee00c36b@group.calendar.google.com`
- **Study** (SAT classes): `ishaanvhemrajani@gmail.com`

## Steps
1. `list_events` on both calendars for Mon 00:00 → next Mon 00:00 Asia/Hong_Kong.
2. Classify:
   - school period titles (`12WW`, `12EN…`) → collapse per day to one `school` lock
   - Ghosh / English / History / Math Tutor → `tutor`
   - Fri after early finish → `social` until 16:00
   - Study calendar Zoom/SAT sessions (Zuperscore, Phoenix, “60 mins - Ishaan”) → `sat_class` with `satTutor: true`
3. Skip: Bhavan, Dr OK, any `DRAFT ·` study event, transparent events.
4. Write `locks/YYYY-MM-DD.json` and `locks/latest.json`.
5. Push + republish deed so every browser fetch sees fresh locks on load.

## Conflict UX
The picker flags study picks that overlap locks — especially **SAT booked classes** vs IB/SAT/Light/Free slots.
