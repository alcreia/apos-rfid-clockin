import { describe, expect, it } from 'vitest';
import { MAX_GAP_MS, judge, measure, type Keystroke } from '../src/web/burst.js';

/** Builds keystrokes `gap` ms apart, ending with Enter `tail` ms after the last one. */
function burstOf(text: string, gap: number, tail = 8): { keys: Keystroke[]; enteredAt: number } {
  const keys: Keystroke[] = [...text].map((ch, i) => ({ at: 1000 + i * gap, ch }));
  return { keys, enteredAt: 1000 + (text.length - 1) * gap + tail };
}

describe('burst timing gate', () => {
  it('accepts a reader burst: 10 digits, 8 ms apart', () => {
    const { keys, enteredAt } = burstOf('1357059979', 8);
    const burst = measure(keys, enteredAt);
    expect(burst.count).toBe(10);
    expect(burst.maxGapMs).toBe(8);
    expect(judge(burst)).toBeNull();
  });

  it('accepts a slower reader still inside the window', () => {
    const { keys, enteredAt } = burstOf('1357059979', MAX_GAP_MS);
    expect(judge(measure(keys, enteredAt))).toBeNull();
  });

  it('rejects a human typing at 120 ms per character', () => {
    const { keys, enteredAt } = burstOf('1357059979', 120);
    expect(judge(measure(keys, enteredAt))).toBe('too-slow');
  });

  it('rejects one slow character in an otherwise fast burst', () => {
    const keys: Keystroke[] = [...'1357059979'].map((ch, i) => ({ at: 1000 + i * 8, ch }));
    // A pause after the 4th character — the hand-off between two fingers.
    for (let i = 5; i < keys.length; i += 1) keys[i] = { at: (keys[i] as Keystroke).at + 200, ch: (keys[i] as Keystroke).ch };
    expect(judge(measure(keys, 1290))).toBe('too-slow');
  });

  it('rejects a held key, which auto-repeats at ~31 ms and beats the gap test', () => {
    const { keys, enteredAt } = burstOf('1111111111', 31);
    expect(measure(keys, enteredAt).maxGapMs).toBeLessThanOrEqual(MAX_GAP_MS);
    expect(judge(measure(keys, enteredAt))).toBe('key-repeat');
  });

  it('rejects a stray keypress or a bare Enter', () => {
    expect(judge(measure([], 1000))).toBe('too-short');
    expect(judge(measure([{ at: 1000, ch: '7' }], 1005))).toBe('too-short');
  });

  it('rejects a whole sentence typed fast enough to pass the gap test', () => {
    const { keys, enteredAt } = burstOf('hello there this is not a card', 10);
    expect(judge(measure(keys, enteredAt))).toBe('too-long');
  });

  it('does not accept a card whose gap is 1 ms past the window', () => {
    const { keys, enteredAt } = burstOf('1357059979', MAX_GAP_MS + 1);
    expect(judge(measure(keys, enteredAt))).toBe('too-slow');
  });

  it('counts Enter as part of the duration', () => {
    const keys: Keystroke[] = [...'1357059979'].map((ch, i) => ({ at: 1000 + i * 8, ch }));
    expect(measure(keys, 1000 + 9 * 8 + 5).durationMs).toBe(77);
  });
});
