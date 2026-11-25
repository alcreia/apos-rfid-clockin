/**
 * Telling a card reader from a human, using only the keyboard events.
 *
 * A wedge reader types the whole UID in one burst — roughly 5-15 ms per character,
 * ending with Enter. A person cannot sustain that: 40 ms per character for ten
 * characters in a row is faster than any human typist, and typing with two fingers on
 * an office keyboard is 150 ms+.
 *
 * So the gate is rhythm, not content. It cannot stop a determined attacker (anyone with
 * the devtools console can POST /api/tap directly) — it stops the realistic problem:
 * somebody at the kiosk PC typing into the window that always has focus.
 */

/** Longest gap allowed between two characters of one burst, in ms. */
export const MAX_GAP_MS = 40;
/** Longest whole burst, first character to Enter, in ms. */
export const MAX_TOTAL_MS = 400;
export const MIN_CHARS = 4;
export const MAX_CHARS = 16;
/** A held key auto-repeats at ~31 ms on Windows, so speed alone is not enough. */
export const MIN_DISTINCT = 3;

export type Keystroke = { at: number; ch: string };

export type Burst = {
  text: string;
  count: number;
  durationMs: number;
  maxGapMs: number;
  distinct: number;
};

export type Rejection = 'too-short' | 'too-long' | 'too-slow' | 'key-repeat';

export function measure(keys: Keystroke[], enteredAt: number): Burst {
  const text = keys.map((k) => k.ch).join('');
  let maxGap = 0;
  for (let i = 1; i < keys.length; i += 1) {
    maxGap = Math.max(maxGap, (keys[i] as Keystroke).at - (keys[i - 1] as Keystroke).at);
  }
  return {
    text,
    count: keys.length,
    // Enter arrives after the last character, so it counts as part of the duration.
    durationMs: keys.length > 0 ? Math.round(enteredAt - (keys[0] as Keystroke).at) : 0,
    maxGapMs: Math.round(maxGap),
    distinct: new Set(text).size,
  };
}

/** null = looks like a card. */
export function judge(burst: Burst): Rejection | null {
  if (burst.count < MIN_CHARS) return 'too-short';
  if (burst.count > MAX_CHARS) return 'too-long';
  if (burst.maxGapMs > MAX_GAP_MS || burst.durationMs > MAX_TOTAL_MS) return 'too-slow';
  if (burst.distinct < MIN_DISTINCT) return 'key-repeat';
  return null;
}
