# The local ledger is the source of truth; the Log tab is a projection

A tap must be confirmed on screen within milliseconds and must never be lost because Google was slow, rate-limited, or unreachable — the employee's obligation is discharged when the card is read, not when Google acknowledges it. Decided: every accepted tap is appended to `data/taps.jsonl` (append + fsync) and answered immediately; the Log tab is written asynchronously from a durable queue, and unsynced entries are replayed on boot.

## Consequences

- `spreadsheets.values.append` is not idempotent, so a retry after a timeout can duplicate a row. Retries following an ambiguous failure first read today's Log rows and skip any `(Day, Card)` that already exists.
- The Log can lag the Ledger by seconds, or by an outage. The kiosk surfaces this as a `N pending` badge rather than hiding it.
- "Did my tap count?" is answerable without network, and a rebuild of the Log is possible from the Ledger alone.
- The Ledger is the only file worth backing up.
