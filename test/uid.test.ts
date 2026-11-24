import { describe, expect, it } from 'vitest';
import { decode, explain, fromReaderDecimal, reverseBytes } from '../src/core/uid.js';

describe('reader decimal -> canonical UID', () => {
  it('converts the documented reader output to the hex form the Log holds', () => {
    // 8B17E350 -> bytes reversed 50 E3 17 8B -> decimal 1357059979
    expect(fromReaderDecimal('1357059979')).toBe('8B17E350');
    expect(fromReaderDecimal('1541472676')).toBe('A401E15B');
  });

  it('pads before reversing, so a UID with a 00 byte survives', () => {
    // 8B17E300 -> reversed 00 E3 17 8B -> decimal 14882699 (8 digits, leading zero lost)
    expect(fromReaderDecimal('14882699')).toBe('8B17E300');
    expect(fromReaderDecimal('0000014882699'.slice(-9))).toBe('8B17E300');
  });

  it('rejects values that cannot be a 4-byte UID', () => {
    expect(fromReaderDecimal('4294967296')).toBeNull(); // 2^32
    expect(fromReaderDecimal('12345678901')).toBeNull(); // 11 digits
    expect(fromReaderDecimal('')).toBeNull();
    expect(fromReaderDecimal('12ab')).toBeNull();
  });

  it('reverses byte order, not nibbles', () => {
    expect(reverseBytes('50E3178B')).toBe('8B17E350');
  });
});

describe('decode', () => {
  it('treats an all-digit burst as decimal', () => {
    expect(decode('1357059979')).toEqual({ uid: '8B17E350', via: 'decimal' });
  });

  it('accepts an already-canonical hex burst', () => {
    expect(decode('8B17E350')).toEqual({ uid: '8B17E350', via: 'hex' });
  });

  it('tolerates separators and lowercase', () => {
    expect(decode(' 8b:17:e3:50 ')).toEqual({ uid: '8B17E350', via: 'hex' });
  });

  it('returns null for junk', () => {
    expect(decode('')).toBeNull();
    expect(decode('hello')).toBeNull();
    expect(decode('ABC')).toBeNull();
    expect(decode('XYZDEF12')).toBeNull();
  });

  it('treats 8 digits as decimal, not hex — the documented reader format wins', () => {
    // 12345678 is a legal hex string too; it must still be read as decimal.
    expect(decode('12345678')).toEqual({ uid: fromReaderDecimal('12345678'), via: 'decimal' });
    expect(decode('12345678')?.uid).not.toBe('12345678');
  });
});

describe('explain (for /dev)', () => {
  it('shows both readings so a misconfigured reader is visible', () => {
    expect(explain('8B17E350')).toEqual({ cleaned: '8B17E350', asDecimal: null, asHex: '8B17E350' });
    expect(explain('1357059979')).toEqual({
      cleaned: '1357059979',
      asDecimal: '8B17E350',
      asHex: null,
    });
  });
});
