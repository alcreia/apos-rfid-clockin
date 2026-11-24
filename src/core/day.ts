/**
 * Time in the office's local zone. Every judgement the system makes (which Day a
 * tap belongs to, what string is written to Log!A) is made here and nowhere else.
 *
 * Log!A holds real datetime values, so the string written must be a *naive* local
 * wall-clock reading with no offset: Sheets parses it in the spreadsheet's own
 * timezone, which is set to Jakarta. See ADR-0004.
 */

export const DEFAULT_TZ = 'Asia/Jakarta';

function parts(date: Date, tz: string, opts: Intl.DateTimeFormatOptions): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) if (p.type !== 'literal') out[p.type] = p.value;
  return out;
}

/** `2026-11-24` in the office's zone. The key for the first-tap-of-the-day rule. */
export function localDay(date: Date, tz = DEFAULT_TZ): string {
  const p = parts(date, tz, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

/** `2026-11-24 08:03:12` — naive local, what goes into Log!A verbatim. */
export function logTimestamp(date: Date, tz = DEFAULT_TZ): string {
  const p = parts(date, tz, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** `08:03` — for the kiosk confirmation. */
export function clockTime(date: Date, tz = DEFAULT_TZ): string {
  const p = parts(date, tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${p.hour}:${p.minute}`;
}

/**
 * Sheets serial (days since 1899-12-30) -> `YYYY-MM-DD`, without touching the
 * spreadsheet's timezone. Used to compare a read-back row against a Day.
 */
export function serialToYmd(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}
