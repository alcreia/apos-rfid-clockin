import { describe, expect, it } from 'vitest';
import {
  columnLetter,
  compareWritten,
  findColumns,
  findTab,
  parseLogRow,
  sheetTimezone,
  spreadsheetAccessHint,
  timezoneProblem,
  type SpreadsheetMeta,
} from '../src/sheets/preflight.js';

const meta: SpreadsheetMeta = {
  properties: { title: 'Absensi 2026', timeZone: 'Asia/Jakarta' },
  sheets: [{ properties: { title: 'Absensi' } }, { properties: { title: 'Log' } }],
};

// 2026-11-24 20:39:39 as a Sheets serial (days since 1899-12-30).
const SERIAL = 46350 + (20 * 3600 + 39 * 60 + 39) / 86_400;

describe('preflight', () => {
  it('finds the Log tab and reports its absence', () => {
    expect(findTab(meta, 'Log')).toBe(true);
    expect(findTab(meta, 'Logs')).toBe(false);
  });

  it('reads the spreadsheet timezone', () => {
    expect(sheetTimezone(meta)).toBe('Asia/Jakarta');
    expect(sheetTimezone({})).toBeNull();
  });

  it('refuses a timezone that would shift every timestamp', () => {
    expect(timezoneProblem('Asia/Jakarta', 'Asia/Jakarta')).toBeNull();
    expect(timezoneProblem('UTC', 'Asia/Jakarta')).toMatch(/wrong hour/);
    expect(timezoneProblem(null, 'Asia/Jakarta')).toMatch(/reports no timezone/);
    expect(timezoneProblem('Not/AZone', 'Asia/Jakarta')).toMatch(/not a timezone this machine can resolve/);
  });

  it('accepts a different zone name with the same UTC offset and no DST', () => {
    // Google ships one entry for "(GMT+07:00) Bangkok, Hanoi, Jakarta" and may report
    // any of the three names; all are UTC+7 all year, so a naive timestamp is identical.
    expect(timezoneProblem('Asia/Bangkok', 'Asia/Jakarta')).toBeNull();
    expect(timezoneProblem('Asia/Ho_Chi_Minh', 'Asia/Jakarta')).toBeNull();
  });

  it('rejects a neighbouring zone that is one hour off', () => {
    expect(timezoneProblem('Asia/Makassar', 'Asia/Jakarta')).toMatch(/wrong hour/);
  });

  it('tells a typo apart from a permissions problem', () => {
    const typo = spreadsheetAccessHint(404, 'abc123', 'sa@proj.iam.gserviceaccount.com');
    expect(typo).toMatch(/no spreadsheet with ID "abc123"/);
    expect(typo).toMatch(/after \/d\/ and before the next/);
    expect(typo).not.toMatch(/Share it with/);

    const denied = spreadsheetAccessHint(403, 'abc123', 'sa@proj.iam.gserviceaccount.com');
    expect(denied).toMatch(/Share it with sa@proj\.iam\.gserviceaccount\.com as Editor/);
    expect(denied).toMatch(/sharing outside the organization/);

    expect(spreadsheetAccessHint(500, 'abc123', 'x')).toMatch(/unexpected response 500/);
  });

  it('parses an appended row back into day, time and uid', () => {
    expect(parseLogRow([SERIAL, '8B17E350'])).toEqual({
      day: '2026-11-24',
      time: '20:39:39',
      uid: '8B17E350',
    });
  });

  it('finds the columns from the header row', () => {
    // The live Log: two columns, A and B.
    expect(findColumns(['Timestamp', 'RFID'])).toEqual({ timestamp: 0, uid: 1 });
    // A layout with the UID further right still works.
    expect(findColumns(['Timestamp', '', '', '', '', 'RFID'])).toEqual({ timestamp: 0, uid: 5 });
    // A header it cannot read is an error, never a guess.
    expect(findColumns(['when', 'who'])).toHaveProperty('error');
    expect(findColumns([])).toHaveProperty('error');
  });

  it('parses a row using the detected columns', () => {
    expect(parseLogRow([SERIAL, '', '', '', '', '8B17E350'], { timestamp: 0, uid: 5 })).toEqual({
      day: '2026-11-24',
      time: '20:39:39',
      uid: '8B17E350',
    });
  });

  it('turns an index into a column letter', () => {
    expect(columnLetter(0)).toBe('A');
    expect(columnLetter(1)).toBe('B');
    expect(columnLetter(25)).toBe('Z');
    expect(columnLetter(26)).toBe('AA');
  });

  it('treats a text timestamp as unparseable rather than guessing', () => {
    expect(parseLogRow(['24 Nov 2026 20:39:39', '8B17E350'])).toBeNull();
  });

  it('passes when the round trip is exact', () => {
    const sent = { timestamp: '2026-11-24 20:39:39', uid: '8B17E350' };
    expect(compareWritten(sent, parseLogRow([SERIAL, '8B17E350']))).toEqual([]);
  });

  it('names each kind of corruption', () => {
    const sent = { timestamp: '2026-11-24 20:39:39', uid: '8B17E350' };
    expect(compareWritten(sent, null)).toEqual([
      'column A did not parse as a datetime — it was stored as text',
    ]);

    // A UTC-configured sheet: the wall clock reads seven hours earlier.
    const shifted = parseLogRow([SERIAL - 7 / 24, '8B17E350']);
    expect(compareWritten(sent, shifted).join(' ')).toMatch(/time shifted/);
  });
});
