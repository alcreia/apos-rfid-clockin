/**
 * Pure checks used before writing to the real workbook.
 *
 * These exist because the three ways this goes wrong are all silent: the service
 * account has no access, the tab is named something else, or the spreadsheet's
 * timezone is not Jakarta — which shifts every timestamp and looks like an app bug.
 */
import { serialToYmd } from '../core/day.js';

export type SpreadsheetMeta = {
  properties?: { title?: string; timeZone?: string };
  sheets?: Array<{ properties?: { title?: string } }>;
};

export function sheetTimezone(meta: SpreadsheetMeta): string | null {
  return meta.properties?.timeZone ?? null;
}

function wallClock(zone: string, at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(at);
}

/**
 * Returns the problem, or null when the sheet reads naive timestamps the way we mean them.
 *
 * Compares the zone's *behaviour*, not its name. Google ships one entry for
 * "(GMT+07:00) Bangkok, Hanoi, Jakarta" and reports whichever name it likes; all three
 * are UTC+7 with no DST, so `Asia/Bangkok` is a correct setting for a Jakarta office.
 * Two probes (January and July) also catch a zone with DST that a single date would miss.
 */
export function timezoneProblem(actual: string | null, expected: string): string | null {
  if (!actual) return 'the spreadsheet reports no timezone';

  const probes = [new Date('2026-01-15T00:00:00Z'), new Date('2026-07-15T00:00:00Z')];
  try {
    const differs = probes.some((at) => wallClock(actual, at) !== wallClock(expected, at));
    if (!differs) return null;
  } catch {
    return `"${actual}" is not a timezone this machine can resolve`;
  }

  return `the spreadsheet timezone is "${actual}", which reads a naive timestamp differently from "${expected}" — rows would land at the wrong hour`;
}

export function findTab(meta: SpreadsheetMeta, tab: string): boolean {
  return (meta.sheets ?? []).some((s) => s.properties?.title === tab);
}

export type ColumnMap = { timestamp: number; uid: number };

/**
 * Which columns actually hold what, read from the header row.
 *
 * Hard-coding this is how a working app writes UIDs into an empty column that
 * nobody reads: the sheet in front of us has `Timestamp | RFID` in A and B, which
 * is two columns away from where one of us believed they were. The header is the
 * only authority.
 */
export function findColumns(header: unknown[]): ColumnMap | { error: string } {
  const cells = header.map((c) => String(c ?? '').trim().toLowerCase());
  const uid = cells.findIndex((c) => /^(rfid|uid|card|card[ _-]?uid|tag)$/.test(c));
  const timestamp = cells.findIndex((c) => /^(timestamp|time|waktu|tanggal|datetime)$/.test(c));

  if (timestamp < 0) return { error: `no timestamp column in the header: ${JSON.stringify(header)}` };
  if (uid < 0) return { error: `no RFID/UID column in the header: ${JSON.stringify(header)}` };
  return { timestamp, uid };
}

/** 0 -> "A", 25 -> "Z", 26 -> "AA". */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * A 404 and a 403 mean different things and need different fixes. Sheets returns
 * 404 for an ID that does not exist and 403 for a file the caller cannot see, so a
 * typo in SHEET_ID must not be reported as a permissions problem.
 */
export function spreadsheetAccessHint(status: number, sheetId: string, email: string): string {
  if (status === 404) {
    return `no spreadsheet with ID "${sheetId}".
  Copy it from the URL: docs.google.com/spreadsheets/d/<SHEET_ID>/edit#gid=…
  It is the part after /d/ and before the next /  — not the #gid= number.`;
  }
  if (status === 403) {
    return `the service account cannot open this spreadsheet.
  Share it with ${email} as Editor.
  In Google Workspace, "sharing outside the organization" may be blocked — a service
  account is an external account, and that must be allowed for this to work.`;
  }
  return `unexpected response ${status} from the Sheets API`;
}

/**
 * A Log row as returned with valueRenderOption=UNFORMATTED_VALUE: a serial number
 * in the timestamp column and the card UID in the column `findColumns` identified.
 */
export function parseLogRow(
  values: unknown[],
  cols: ColumnMap = { timestamp: 0, uid: 1 },
): { day: string; time: string; uid: string } | null {
  const serial = Number(values[cols.timestamp]);
  if (!Number.isFinite(serial)) return null;
  const uid = String(values[cols.uid] ?? '').trim().toUpperCase();
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial * 86_400_000);
  const time = new Date(ms).toISOString().slice(11, 19);
  return { day: serialToYmd(serial), time, uid };
}

/** Compares a written value against what came back, and names the difference. */
export function compareWritten(
  sent: { timestamp: string; uid: string },
  readBack: { day: string; time: string; uid: string } | null,
): string[] {
  if (!readBack) return ['column A did not parse as a datetime — it was stored as text'];
  const problems: string[] = [];
  if (readBack.uid !== sent.uid) problems.push(`uid: wrote ${sent.uid}, read ${readBack.uid}`);
  if (readBack.day !== sent.timestamp.slice(0, 10)) {
    problems.push(`date shifted: wrote ${sent.timestamp.slice(0, 10)}, read ${readBack.day}`);
  }
  if (readBack.time !== sent.timestamp.slice(11)) {
    problems.push(`time shifted: wrote ${sent.timestamp.slice(11)}, read ${readBack.time}`);
  }
  return problems;
}
