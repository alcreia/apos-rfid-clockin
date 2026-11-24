import { describe, expect, it } from 'vitest';
import fixture from './fixtures/reader-decimals.json' with { type: 'json' };
import { decode, decodeUid, fromReaderDecimal } from '../src/core/uid.js';

/**
 * Every card in the office, straight out of the firmware table
 * (`data/cards.c`, converted by `scripts/cards-from-c.ts`).
 *
 * This is the acceptance test that matters: 42 independent real cards whose
 * canonical UID is already written into the existing Log history. If the reader's
 * byte order or radix is ever wrong, or `fromReaderDecimal` regresses, one of these
 * 42 fails — and it fails here instead of on someone's attendance record.
 */
const cards = fixture as Array<{ hex: string; decimal: string }>;

describe('real cards', () => {
  it('has 42 distinct cards', () => {
    expect(cards).toHaveLength(42);
    expect(new Set(cards.map((c) => c.hex)).size).toBe(42);
  });

  it.each(cards)('decodes the reader burst for $hex', ({ hex, decimal }) => {
    expect(fromReaderDecimal(decimal)).toBe(hex);
    expect(decode(decimal)).toEqual({ uid: hex, via: 'decimal' });
  });

  it('pins the one card we can check by hand', () => {
    // Example Employee: firmware bytes {139,23,227,80} = 8B 17 E3 50.
    const adrian = cards.find((c) => c.hex === '8B17E350');
    expect(adrian?.decimal).toBe('1357059979');
  });

  it('is idempotent: a hex burst for any card with a letter decodes unchanged', () => {
    for (const { hex } of cards) {
      if (!/[A-F]/.test(hex) || /^\d{8}$/.test(hex)) continue;
      expect(decode(hex)).toEqual({ uid: hex, via: 'hex' });
    }
  });

  /**
   * Real-world ambiguity, found by running this test: `54828750` is a legal hex UID
   * *and* a legal decimal, so a reader burst and a typed value for it must be read by
   * different rules. A reader always sends decimal, so at the door the decimal wins;
   * a paste is treated as hex, but only when explicitly marked.
   */
  it('documents the card whose UID is all digits', () => {
    const bintang = cards.find((c) => c.hex === '54828750');
    expect(bintang?.decimal).toBe('1351058004');

    // A reader burst of that decimal is unambiguous and decodes correctly.
    expect(decode('1351058004')).toEqual({ uid: '54828750', via: 'decimal' });

    // Typed hex is ambiguous, so it is refused rather than guessed.
    expect(decodeUid('54828750')).toHaveProperty('error');
    expect(decodeUid('hex:54828750')).toEqual({ uid: '54828750', via: 'hex' });
  });

  it('documents the card whose decimal is only 8 digits', () => {
    // 058F8F02 sends 42962693 — also a legal hex string.
    const angelica = cards.find((c) => c.hex === '058F8F02');
    expect(angelica?.decimal).toBe('42962693');
    expect(decode('42962693')).toEqual({ uid: '058F8F02', via: 'decimal' });
    expect(decodeUid('42962693')).toHaveProperty('error');
    expect(decodeUid('dec:42962693')).toEqual({ uid: '058F8F02', via: 'decimal' });
  });
});
