import { describe, expect, it } from 'vitest';
import { localDay, logTimestamp, serialToYmd, clockTime } from '../src/core/day.js';

describe('local Day in Asia/Jakarta (UTC+7, no DST)', () => {
  it('rolls over at local midnight, not UTC midnight', () => {
    // 17:30Z on the 24th is 00:30 on the 25th in Jakarta.
    expect(localDay(new Date('2026-11-24T17:30:00Z'))).toBe('2026-11-25');
    // 16:59Z on the 24th is 23:59 on the 24th in Jakarta.
    expect(localDay(new Date('2026-11-24T16:59:00Z'))).toBe('2026-11-24');
  });

  it('writes a naive local timestamp with no offset, seconds intact', () => {
    expect(logTimestamp(new Date('2026-11-24T01:03:35Z'))).toBe('2026-11-24 08:03:35');
    expect(logTimestamp(new Date('2026-11-24T16:59:07Z'))).toBe('2026-11-24 23:59:07');
  });

  it('formats midnight as 00, never 24', () => {
    expect(logTimestamp(new Date('2026-11-24T17:00:00Z'))).toBe('2026-11-25 00:00:00');
  });

  it('gives the kiosk a HH:mm label', () => {
    expect(clockTime(new Date('2026-11-24T01:03:35Z'))).toBe('08:03');
  });
});

describe('sheet serial -> day', () => {
  it('reads a serial the way the sheet stores it', () => {
    // 1899-12-30 + 46350 days = 2026-11-24
    expect(serialToYmd(46350)).toBe('2026-11-24');
    expect(serialToYmd(46350.5)).toBe('2026-11-24');
    // 2022-07-01, the date of the sample rows
    expect(serialToYmd(44743)).toBe('2022-07-01');
  });
});
