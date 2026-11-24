/**
 * Writes rows into the existing Log tab and reads them back.
 *
 * Where the columns are is **read from the header row**, never assumed. The live
 * workbook has `Timestamp | RFID` in A and B; an earlier version of this file wrote
 * the UID to column F, which would have produced rows that look plausible and that
 * `Absensi` never reads.
 *
 * Log!A is a real datetime value, so rows go in with USER_ENTERED and a naive local
 * string; RAW would append text into a datetime column and those rows would silently
 * vanish from Absensi's date lookups (ADR-0004).
 *
 * Reads use UNFORMATTED_VALUE so the timestamp comes back as a Sheets serial number,
 * independent of the workbook's locale and display format.
 */
import fs from 'node:fs';
import path from 'node:path';
import { JWT } from 'google-auth-library';
import { serialToYmd } from '../core/day.js';
import { columnLetter, findColumns, type ColumnMap } from './preflight.js';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

export type AppendRow = { timestamp: string; uid: string };

export interface ClockInSink {
  append(row: AppendRow): Promise<void>;
  /** True when the sheet already holds a row for this Day + Card. */
  exists(day: string, uid: string): Promise<boolean>;
}

export type SheetsConfig = { sheetId: string; tab: string; keyPath: string };

export class GoogleSheetsSink implements ClockInSink {
  private auth: JWT | null = null;
  private cols: ColumnMap | null = null;

  constructor(private readonly cfg: SheetsConfig) {}

  private async token(): Promise<string> {
    if (!this.auth) {
      const creds = JSON.parse(fs.readFileSync(this.cfg.keyPath, 'utf8')) as {
        client_email: string;
        private_key: string;
      };
      this.auth = new JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    }
    const res = await this.auth.getAccessToken();
    if (!res.token) throw new Error('could not obtain an access token');
    return res.token;
  }

  private range(a1: string): string {
    return encodeURIComponent(`${this.cfg.tab}!${a1}`);
  }

  /** Last column we touch, as a letter — the append range has to cover it. */
  private lastColumn(): string {
    if (!this.cols) throw new Error('columns not loaded');
    return columnLetter(Math.max(this.cols.timestamp, this.cols.uid));
  }

  /** Reads the header once per process and caches where the data lives. */
  async columns(): Promise<ColumnMap> {
    if (this.cols) return this.cols;

    const url = `${SHEETS}/${this.cfg.sheetId}/values/${this.range('A1:Z1')}?valueRenderOption=FORMATTED_VALUE`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${await this.token()}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`could not read the ${this.cfg.tab} header: ${res.status} ${await res.text()}`);

    const body = (await res.json()) as { values?: unknown[][] };
    const header = body.values?.[0] ?? [];
    const found = findColumns(header);
    if ('error' in found) throw new Error(`${this.cfg.tab} header: ${found.error}`);

    this.cols = found;
    return found;
  }

  async append(row: AppendRow): Promise<void> {
    const cols = await this.columns();
    const width = Math.max(cols.timestamp, cols.uid) + 1;
    const cells = Array<string>(width).fill('');
    cells[cols.timestamp] = row.timestamp;
    cells[cols.uid] = row.uid;

    const url =
      `${SHEETS}/${this.cfg.sheetId}/values/${this.range(`A:${this.lastColumn()}`)}:append` +
      `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await this.token()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: [cells] }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`append failed ${res.status}: ${await res.text()}`);
  }

  async exists(day: string, uid: string): Promise<boolean> {
    const cols = await this.columns();
    const url =
      `${SHEETS}/${this.cfg.sheetId}/values/${this.range(`A:${this.lastColumn()}`)}` +
      `?valueRenderOption=UNFORMATTED_VALUE`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${await this.token()}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`read failed ${res.status}: ${await res.text()}`);

    const body = (await res.json()) as { values?: unknown[][] };
    for (const row of body.values ?? []) {
      const serial = Number(row[cols.timestamp]);
      const cellUid = String(row[cols.uid] ?? '').trim().toUpperCase();
      if (!Number.isFinite(serial) || !cellUid) continue;
      if (cellUid === uid && serialToYmd(serial) === day) return true;
    }
    return false;
  }
}

/** No-credentials mode: records what would have been appended, so the app is runnable today. */
export class StubSink implements ClockInSink {
  constructor(private readonly file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  async append(row: AppendRow): Promise<void> {
    fs.appendFileSync(this.file, `${JSON.stringify(row)}\n`);
  }

  async exists(): Promise<boolean> {
    return false;
  }
}
