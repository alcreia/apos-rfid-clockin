# Timestamps are written as parsed datetimes, not as text

`Log!A` holds real datetime values — the formula bar shows `7/1/2022 9:44:23` while the cell renders `1 Jul 2022 9:44:23`. Decided: append with `valueInputOption=USER_ENTERED` and a naive local string `YYYY-MM-DD HH:MM:SS`, so Sheets parses it and the column's number format renders it like every existing row.

## Consequences

- `RAW` would append text into a datetime column. Those rows would sort into a separate block and drop out of `Absensi`'s date-based lookups — the failure is silent, which is why this is recorded.
- A naive string carries no offset, so it is interpreted in the **spreadsheet's** timezone. That setting must be `Asia/Jakarta`; if it is something else every timestamp shifts by the difference, and nothing in the payload reveals it.
- The smoke test appends a known timestamp to a scratch sheet, reads the cell back, and asserts the parsed value equals what was sent. A locale or timezone regression shows up there rather than in payroll.
- The reader is free to be fast or slow; the timestamp is taken from the server clock at the moment the tap is accepted, never from Sheets.
