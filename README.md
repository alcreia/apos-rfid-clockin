# rfid-clockin

One kiosk PC at the office door. An employee taps a MIFARE card, the reader types a
decimal burst, and the app appends a row to the company's existing Google Sheet —
`Log!A` (Timestamp) and `Log!B` (RFID) — the two columns `Absensi` already reads. The
column positions are not hard-coded: the app reads the header row and follows it.

The app decides nothing about lateness. It records a moment, once per person per day.

Read `GLOSSARY.md` for the vocabulary and `docs/adr/` for the decisions that are
expensive to reverse.

## What it does, precisely

| Step | Behaviour |
|---|---|
| Card tapped | reader types e.g. `1357059979` + Enter into the focused input |
| Decode | decimal → hex → byte-reverse → `8B17E350` (the form the Log already holds) |
| Unknown card | rejected, never written; recorded in `data/rejected.jsonl`, visible on `/dev` |
| First tap today | appended to `data/taps.jsonl` (fsynced), confirmed on screen with a name |
| Second tap today | no row written; screen says "Already clocked in at 08:03" |
| Google slow / down | the tap is already recorded locally; the queue retries with backoff |
| Restart | ledger replays; today's dedupe index and the unsynced queue are rebuilt |

## Run it

```bash
npm install
npm run build
npm start            # http://127.0.0.1:<PORT from .env>  (kiosk)  ·  /dev (enrolment)
```

`npm run dev` runs the API on `PORT` from `.env` and Vite on :5173 with `/api` proxied.
`PORT` is set in exactly one place; `scripts\kiosk.bat` asks the server for its own URL
(`data/kiosk-url.txt`) rather than hard-coding one.

`SHEETS_MODE=stub` (the default) records taps locally and never calls Google. Nothing
can reach the real spreadsheet until you set `SHEETS_MODE=live`.

## Enrolling cards

Three ways in, all on `/dev`, all writing `data/employees.json`:

1. **Bulk paste** — one row per card, delimiter tab (paste straight from Sheets), comma,
   or semicolon. The UID column takes either the 8-hex form or the reader's decimal, so a
   list of printed card numbers imports fine before the reader is plugged in. A header row
   is detected and skipped; `#` starts a comment. Press **Preview** to see exactly what
   would change — every row is marked added / updated / unchanged / skipped — and nothing
   is written until you press **Apply**.
2. **Tap one card** — tap it into the Reader output box, type the name, press **Enrol card**.
3. **Assign from a rejected tap** — a card that was tapped while unenrolled appears in the
   Rejected taps table with its decoded UID; type a name there and press **assign**. This
   is the fast path for a batch of new cards: tap all of them, then name them.

**Export CSV** downloads the roster in the format the bulk import reads back, so the list
survives a lost laptop. Merge mode never deletes: use `replace` only when the paste is the
complete, final roster — it removes anyone missing from it, and says so in the preview.

### From the firmware card table

`data/cards.c` (gitignored — it holds names) is the canonical card list. Regenerate the
roster from it after any change:

```bash
tsx scripts/cards-from-c.ts data/cards.c
# -> data/roster-import.csv   paste this into /dev, mode "replace"
# -> test/fixtures/reader-decimals.json   UIDs + reader decimals, no names
```

It refuses to emit a roster if two cards share a UID, and it verifies `8B17E350` on the way
out.

The table holds 42 cards; 22 carry a `_` prefix marking people who have left. The live
roster keeps only the 20 active employees, so drop them at generation time:

```bash
tsx scripts/cards-from-c.ts data/cards.c --exclude=_
# -> data/roster-active.csv   20 rows, paste into /dev with mode "replace"
```

Importing the unfiltered `roster-import.csv` would re-add every leaver, and they would start
clocking in again: roster membership is what gates a Log row.

### The `hex:` / `dec:` prefixes

An 8-digit value is both a valid hex UID and a valid reader decimal — `54828750` is a card
whose hex UID happens to be all digits, and `42962693` is another card's reader decimal.
A pasted value is read as **hex** by
default; an ambiguous 8-digit value is refused with an error rather than guessed. Force the
reading with a prefix when you need to:

```
hex:54828750,_bintang
dec:42962693,Example Name
```

Reader bursts are unaffected: at the door a digit string is always decimal, because that is
what the reader sends. See `docs/adr/0005`. 

Enrol before the person's first morning: a card that is not in the roster is not written to
the Log. `DEV=0` removes `/dev` and all of these endpoints from the live kiosk.

## Going live

1. **Google Cloud**: new project → enable *Google Sheets API* → create a service
   account → add a JSON key → note `…@….iam.gserviceaccount.com`. No billing needed.
2. **Share the workbook** with that service-account address as **Editor**. If it is a
   Workspace file with external sharing restricted, this step fails — see ADR-0002
   and the trust-rules note; a blocked service account cannot be worked around in code.
3. **Check the workbook timezone**: File → Settings → Time zone must be
   `(GMT+07:00) Jakarta`. A naive timestamp is interpreted in that zone (ADR-0004).
4. **Preflight, then smoke test.** Both read `SHEET_ID` / `SA_KEY_PATH` / `TZ_NAME` from
   `.env`. Run against a *copy* of the workbook first, then the real one:

   ```bash
   npm run smoke -- --check-only   # token, file visible, tab exists, timezone is Jakarta
   npm run smoke                   # appends one row (UID FFFFFFFF) and reads it back
   ```

   `--check-only` writes nothing and is safe on the live sheet any time. The full run
   proves Google parsed the value as a datetime rather than text, and that no timezone
   shift was applied — the two failures that look like app bugs and are not. Delete the
   smoke row it names afterwards.

   If it says the service account cannot open the spreadsheet, that is the Workspace
   sharing restriction from step 2 — it cannot be worked around in code.
5. Set `SHEETS_MODE=live`, `SHEET_ID=…`, `DEV=0`, and delete `data/` so the test taps
   never reach the real Log.

## Deploying to the door PC

The kiosk needs this folder and Node 22 — no database, no share, no build server.

1. Copy the project to the kiosk PC (say `D:\apos-rfid`) and install:

   ```bash
   npm ci
   npm run build
   ```

2. Copy in the three things git does not carry, then clear the rest:

   - `.env` — with `SHEETS_MODE=live`, `DEV=0`, `SHEET_ID=…`
   - `secrets/sa.json` — the service-account key
   - `data/employees.json` — the roster

   Delete every other file in `data/` so the kiosk starts with an empty ledger and
   no leftover taps from testing.

3. One scheduled task at logon, pointing at the VBS so **no console windows** appear.

   **If you already created the two tasks from an earlier version of this guide,
   delete them first.** Otherwise two servers start at logon, the second cannot bind the
   port, and its retry loop spins every 5 seconds forever:

   ```bat
   schtasks /delete /tn "RFID clock-in server" /f
   schtasks /delete /tn "RFID kiosk" /f
   schtasks /create /tn "RFID clock-in kiosk" /tr "wscript.exe D:\apos-rfid\scripts\hidden.vbs" /sc onlogon
   ```

   Then check that exactly one task exists and that it runs `wscript.exe`, not a `.bat`:

   ```bat
   schtasks /query /fo table | findstr /i rfid
   schtasks /query /tn "RFID clock-in kiosk" /v /fo list | findstr /i "Task To Run"
   ```

   `hidden.vbs` launches `serve.bat` and `kiosk.bat` with no window. You never run
   `npm start` by hand and never leave a window open. Both scripts loop: the server
   comes back 5 s after any crash, the browser reopens within 20 s if it is closed.
   Server output goes to `data\server.log` — delete that file to clear it, read it when
   a tap does not arrive.

   Deleting a task does not stop an instance it already started, so reboot the door PC
   once after this step. That also tests the thing the task exists for.

   If the project path contains spaces, quote it inside `/tr`: `"wscript.exe \"D:\my
   folder\scripts\hidden.vbs\""`. To stop everything, end the task in Task Scheduler
   (closing a console window is no longer part of the workflow).

4. Power: display never sleeps, PC never sleeps, autologon enabled — so the screen
   comes back by itself after a power cut. A reboot mid-day loses nothing: the ledger
   replays and the sync queue drains.

5. Verify at the door: `curl http://127.0.0.1:<PORT>/api/health` should report
   `"mode":"live"`, then tap one card and check the row in the sheet.

`DEV=0` removes `/dev` and the enrolment endpoints, so nobody at the door can add a
card or read the rejected-tap log. To enrol a new hire later, set `DEV=1`, restart,
enrol, then set it back to `0`.

## Verifying the reader (do this first, before trusting any of it)

The reader's documented output — "decimal of the UID in reverse byte order" — is
encoded in `src/core/uid.ts`. Confirm it against reality with a card that already
appears in the old Log:

1. Tap that card into `/dev`.
2. `/dev` shows the raw burst, the decimal reading, and the hex reading.
3. Compare the decoded UID to the hex in the historic Log row for that card.

If they differ, the reader is emitting a byte order or radix other than documented.
Every tap keeps `uidRaw` alongside the canonical UID in the ledger, so a mis-decode
found later is recoverable by re-deriving the canonical value from the raw strings —
no data loss. Fix `fromReaderDecimal` first anyway.

## Tests

```bash
npm test          # 91 tests: UID decode, 42 real cards, Day boundary, dedupe, ledger, import, queue
npm run typecheck

# what does this burst decode to? (paste one from the door)
tsx scripts/decode-burst.ts 1357059979
```

The parts worth testing are the parts with no network and no UI: the decimal →
hex → byte-reverse conversion (including the leading-`00` byte case), the local
midnight boundary, the first-tap rule, and the queue's "append timed out but landed"
path.
