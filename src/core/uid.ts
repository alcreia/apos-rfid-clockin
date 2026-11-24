/**
 * Card identity.
 *
 * The Log tab (and therefore Absensi) keys on the MIFARE Classic UID written as
 * eight uppercase hex characters, MSB-first: `8B17E350`.
 *
 * The reader in the doorway emits the *decimal* integer of those same four bytes
 * in *reverse* order: `8B17E350` -> bytes `50 E3 17 8B` -> `1357059979`.
 *
 * So every tap has to be reconstructed, not merely normalised. Two traps:
 *  - the padding must happen BEFORE the byte reversal, or a UID containing a
 *    leading 0x00 byte (after reversal) loses it: `8B17E300` -> `14882699`;
 *  - an all-digit string is ambiguous (valid decimal, valid hex), so the reader's
 *    documented format decides: digits mean decimal.
 */

const CANONICAL = /^[0-9A-F]{8}$/;
const DIGITS = /^\d{1,10}$/;

export function isCanonicalUid(value: string): boolean {
  return CANONICAL.test(value);
}

/** Reverses the byte order of an 8-char hex string, i.e. `50E3178B` -> `8B17E350`. */
export function reverseBytes(hex: string): string {
  if (!CANONICAL.test(hex)) throw new Error(`expected 8 hex chars, got ${JSON.stringify(hex)}`);
  const bytes = hex.match(/../g);
  if (!bytes) throw new Error('unreachable');
  return bytes.reverse().join('');
}

/** Reader output -> canonical UID. Returns null when the value cannot be a card. */
export function fromReaderDecimal(value: string): string | null {
  const digits = value.trim();
  if (!DIGITS.test(digits)) return null;
  const n = Number(digits);
  if (!Number.isSafeInteger(n) || n > 0xffffffff) return null;
  return reverseBytes(n.toString(16).toUpperCase().padStart(8, '0'));
}

export type Decoded = { uid: string; via: 'decimal' | 'hex' };

/**
 * Decodes a full reader burst. Digits are read as decimal (the reader's format);
 * anything else that looks like hex is accepted as an already-canonical UID, so a
 * misconfigured reader is a visible inconsistency rather than silent garbage.
 */
export function decode(raw: string): Decoded | null {
  const cleaned = raw.replace(/[\s:.-]/g, '').toUpperCase();
  if (cleaned.length === 0) return null;
  if (/^\d+$/.test(cleaned)) {
    const uid = fromReaderDecimal(cleaned);
    return uid ? { uid, via: 'decimal' } : null;
  }
  if (CANONICAL.test(cleaned)) return { uid: cleaned, via: 'hex' };
  return null;
}

/** Both readings, for the /dev page: shows what a misconfigured reader is emitting. */
export function explain(raw: string): { cleaned: string; asDecimal: string | null; asHex: string | null } {
  const cleaned = raw.replace(/[\s:.-]/g, '').toUpperCase();
  return {
    cleaned,
    asDecimal: fromReaderDecimal(cleaned),
    asHex: CANONICAL.test(cleaned) ? cleaned : null,
  };
}

/** An 8-digit value is a legal hex UID *and* a legal reader decimal. Never guess. */
export function isAmbiguous(value: string): boolean {
  return /^\d{8}$/.test(value.trim().replace(/[\s:.-]/g, ''));
}

/**
 * Typed input — bulk paste, enrolment forms. Different rules from a reader burst:
 * hex is the default (the roster's canonical form, and what the firmware table
 * holds), decimal only when the value cannot be hex. `hex:` / `dec:` force either.
 *
 * Refusing the ambiguous 8-digit case is deliberate. One card in the office
 * (`54828750`) has an all-digit hex UID; reading it as decimal would enrol a card
 * nobody holds and leave that person unable to clock in.
 */
export function decodeUid(raw: string): Decoded | { error: string } {
  const trimmed = raw.trim();

  const prefixed = /^(hex|dec)\s*:\s*(.*)$/i.exec(trimmed);
  if (prefixed) {
    const kind = prefixed[1]!.toLowerCase();
    const body = prefixed[2]!.replace(/[\s:.-]/g, '').toUpperCase();
    if (kind === 'hex') {
      return CANONICAL.test(body)
        ? { uid: body, via: 'hex' }
        : { error: `"${raw}" is not 8 hex characters` };
    }
    const uid = fromReaderDecimal(body);
    return uid ? { uid, via: 'decimal' } : { error: `"${raw}" is not a reader decimal` };
  }

  const cleaned = trimmed.replace(/[\s:.-]/g, '').toUpperCase();

  // Letters present: it can only be hex.
  if (CANONICAL.test(cleaned) && /[A-F]/.test(cleaned)) return { uid: cleaned, via: 'hex' };

  if (/^\d{8}$/.test(cleaned)) {
    return {
      error: `"${raw}" is ambiguous — 8 digits read as hex and as a decimal. Prefix it "hex:" or "dec:"`,
    };
  }

  if (/^\d{1,10}$/.test(cleaned)) {
    const uid = fromReaderDecimal(cleaned);
    if (uid) return { uid, via: 'decimal' };
  }

  return { error: `cannot read "${raw}" as a card UID` };
}
