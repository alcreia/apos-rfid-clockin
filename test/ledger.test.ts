import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Ledger, type TapRecord } from '../src/core/ledger.js';

function tempLedger(): Ledger {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfid-ledger-'));
  return new Ledger(path.join(dir, 'taps.jsonl'));
}

function tap(id: string, over: Partial<TapRecord> = {}): TapRecord {
  return {
    type: 'tap',
    id,
    at: '2026-11-24T01:03:35.000Z',
    day: '2026-11-24',
    uid: '8B17E350',
    uidRaw: '1357059979',
    name: 'Ayu',
    timestamp: '2026-11-24 08:03:35',
    ...over,
  };
}

describe('ledger', () => {
  it('round-trips a tap, keeping the raw reader string', () => {
    const ledger = tempLedger();
    ledger.append(tap('a'));

    const { taps, synced } = ledger.load();
    expect(taps).toHaveLength(1);
    expect(taps[0]?.uid).toBe('8B17E350');
    expect(taps[0]?.uidRaw).toBe('1357059979');
    expect(synced.size).toBe(0);
  });

  it('reports only unsynced taps, in order', () => {
    const ledger = tempLedger();
    ledger.append(tap('a'));
    ledger.append(tap('b', { uid: 'A401E15B' }));
    ledger.append({ type: 'synced', id: 'a', at: '2026-11-24T01:04:00.000Z' });

    expect(ledger.unsynced().map((t) => t.id)).toEqual(['b']);
  });

  it('survives a torn final line from an interrupted write', () => {
    const ledger = tempLedger();
    ledger.append(tap('a'));
    fs.appendFileSync(ledger.file, '{"type":"tap","id":"b","at"');

    const { taps } = ledger.load();
    expect(taps.map((t) => t.id)).toEqual(['a']);
  });

  it('is empty when the file does not exist yet', () => {
    const ledger = new Ledger(path.join(os.tmpdir(), `rfid-none-${crypto.randomUUID()}`, 'taps.jsonl'));
    expect(ledger.read()).toEqual([]);
    expect(ledger.unsynced()).toEqual([]);
  });
});
