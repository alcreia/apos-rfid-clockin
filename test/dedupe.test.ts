import { describe, expect, it } from 'vitest';
import { DedupeIndex } from '../src/core/dedupe.js';

const day = '2026-11-24';

describe('first tap of the Day wins', () => {
  it('remembers a (Day, Card) pair', () => {
    const index = new DedupeIndex();
    expect(index.has(day, '8B17E350')).toBe(false);
    index.add(day, '8B17E350');
    expect(index.has(day, '8B17E350')).toBe(true);
  });

  it('scopes to the Day, so tomorrow is a fresh clock-in', () => {
    const index = new DedupeIndex();
    index.add(day, '8B17E350');
    expect(index.has('2026-11-25', '8B17E350')).toBe(false);
  });

  it('scopes to the Card, so two people are independent', () => {
    const index = new DedupeIndex();
    index.add(day, '8B17E350');
    expect(index.has(day, 'A401E15B')).toBe(false);
  });

  it('rebuilds from durable taps at boot', () => {
    const index = new DedupeIndex();
    index.load([
      { day, uid: '8B17E350' },
      { day, uid: 'A401E15B' },
    ]);
    expect(index.size).toBe(2);
    expect(index.has(day, 'A401E15B')).toBe(true);
  });
});
