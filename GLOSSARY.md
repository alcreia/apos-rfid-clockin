# RFID Attendance (kiosk)

A single kiosk PC in an office doorway records the moment an employee taps an RFID card, and pushes that moment into the company's existing Google Sheet.

## Language

**Tap**:
One presentation of a card to the reader, delivered to the kiosk as a burst of keystrokes.
_Avoid_: scan, swipe, punch, badge

**ClockIn**:
The recorded fact that an Employee started work on a given Day. At most one exists per Employee per Day.
_Avoid_: attendance record, entry, punch-in

**Card**:
A 13.56 MHz MIFARE Classic card, identified by its 4-byte UID written as eight uppercase hex characters (e.g. `8B17E350`).
_Avoid_: tag, badge, fob

**Roster**:
The set of active Cards and the Employees they belong to.
_Avoid_: employee list, whitelist

**Log**:
The append-only sheet tab whose `Timestamp` and `RFID` columns hold every ClockIn — A and B in the live workbook, discovered from the header rather than assumed. The company's absolute attendance record.
_Avoid_: raw data, history

**Absensi**:
The sheet tab that maps Card UIDs to Employees and decides who is late. External to this app: read-only here.
_Avoid_: dashboard, report

**Ledger**:
The local append-only file `data/taps.jsonl` holding every Tap the app accepted. What the app trusts.
_Avoid_: cache, buffer, queue

**Projection**:
A copy of the Ledger held somewhere else, rebuildable from it. The Log tab is one.
_Avoid_: mirror, sync target

**Kiosk**:
The fullscreen browser page at the door, and by extension the PC it runs on.
_Avoid_: terminal, station, device

**Day**:
The local calendar day in `Asia/Jakarta`, 00:00:00 to 23:59:59. The scope of the first-tap rule.
_Avoid_: date, shift day
