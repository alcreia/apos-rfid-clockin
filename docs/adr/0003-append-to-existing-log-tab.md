# Clock-ins are appended to the existing Log tab, in its existing shape

The workbook already works: `Absensi` reads the `Log` tab's `Timestamp` and `RFID` columns, maps the UID to an employee, and decides lateness. Introducing a second, better-shaped tab would either strand that logic or duplicate it, and would split attendance history across two places. Decided: the app appends to `Log` as it is — two cells per row, a datetime and the card UID.

## Consequences

- The Log holds exactly two columns and the app writes only those. No name, no employee ID, no lateness verdict: those belong to `Absensi`.
- **The app never writes to `Absensi`, and who owns a UID there is the company's business.** The two lists can disagree — the workbook currently has three UIDs assigned to a different person than the firmware table (a reissued card, most likely) and six UIDs that have never appeared in the Log. Reconciling those is a human decision made in the sheet; `tsx scripts/sheet.ts compare` prints the differences and when each disputed card was last used.
- **Where those columns are is read from the header row at runtime**, never hard-coded. The live workbook has `Timestamp` in A and `RFID` in B. An earlier version of this app wrote to column F on the strength of a written description of the sheet, which would have produced rows that look plausible and that `Absensi` never reads — the failure has no error, only silence. `findColumns` now parses the header, and the smoke test reports the mapping before writing anything.
- Identity is the Card, not the person. Reissuing a card is a change in `Absensi`, and the app neither knows nor needs to know that it happened.
- The app writes **at most one row per Employee per Day**, so `Absensi`'s last-entry lookup and the app's first-tap rule always agree. Without that, an accidental second tap would move someone's recorded arrival later and could turn an on-time arrival into a late one.
- The kiosk needs names for its 3-second confirmation, and `Absensi` exposes none that can be parsed reliably, so the Roster is hand-kept in `data/employees.json` and seeded at the door through `/dev`. The cost of a second list is drift: someone active in `Absensi` but absent here is rejected at the door.
- Roster membership gates the write: a Card that is not in `data/employees.json` produces no Log row. This keeps the company's attendance record free of unknown cards and day-trippers, at the cost that a new hire whose card was never enrolled clocks in silently on their first morning — which is why `/dev` lists every rejected tap.

