import { describe, expect, it, vi } from 'vitest';
import { SyncQueue, type ClockInSink } from '../src/core/syncQueue.js';
import type { TapRecord } from '../src/core/ledger.js';

function tap(id: string, over: Partial<TapRecord> = {}): TapRecord {
  return {
    type: 'tap',
    id,
    at: '2026-11-24T01:03:35Z',
    day: '2026-11-24',
    uid: '8B17E350',
    uidRaw: '1357059979',
    name: 'Ayu',
    timestamp: '2026-11-24 08:03:35',
    ...over,
  };
}

const fast = { backoffMs: [0, 0, 0], maxAttempts: 3, sleep: async () => {} };

describe('sync queue', () => {
  it('appends once and reports success', async () => {
    const append = vi.fn(async () => {});
    const onSynced = vi.fn();
    const sink: ClockInSink = { append, exists: async () => false };
    const q = new SyncQueue(sink, { ...fast, onSynced });

    q.enqueue(tap('a'));
    await q.drain();

    expect(append).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledWith({ timestamp: '2026-11-24 08:03:35', uid: '8B17E350' });
    expect(onSynced).toHaveBeenCalledWith('a');
    expect(q.pendingCount).toBe(0);
  });

  it('retries a transient failure', async () => {
    let calls = 0;
    const append = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('503');
    });
    const q = new SyncQueue({ append, exists: async () => false }, fast);

    q.enqueue(tap('b'));
    await q.drain();

    expect(append).toHaveBeenCalledTimes(2);
    expect(q.pendingCount).toBe(0);
  });

  it('does not duplicate a row that an earlier attempt already wrote', async () => {
    // The classic failure: the append succeeded but the response timed out.
    const append = vi.fn(async () => {
      throw new Error('timeout');
    });
    const exists = vi.fn(async () => true);
    const onSynced = vi.fn();
    const q = new SyncQueue({ append, exists }, { ...fast, onSynced });

    q.enqueue(tap('c'));
    await q.drain();

    expect(append).toHaveBeenCalledTimes(1); // never retried
    expect(exists).toHaveBeenCalledWith('2026-11-24', '8B17E350');
    expect(onSynced).toHaveBeenCalledWith('c');
    expect(q.pendingCount).toBe(0);
  });

  it('gives up after maxAttempts and keeps going with the rest', async () => {
    const onFailed = vi.fn();
    const append = vi.fn(async (row: { uid: string }) => {
      if (row.uid === 'DEADBEEF') throw new Error('permanent');
    });
    const q = new SyncQueue({ append, exists: async () => false }, { ...fast, onFailed });

    q.enqueue(tap('d', { uid: 'DEADBEEF' }));
    q.enqueue(tap('e', { uid: 'A401E15B' }));
    await q.drain();

    expect(onFailed).toHaveBeenCalledTimes(1);
    expect(q.pendingCount).toBe(0);
  });

  it('preserves order', async () => {
    const seen: string[] = [];
    const append = async (row: { uid: string }) => {
      seen.push(row.uid);
    };
    const q = new SyncQueue({ append, exists: async () => false }, fast);

    q.enqueue(tap('1', { uid: 'AAAABBBB' }));
    q.enqueue(tap('2', { uid: 'CCCCDDDD' }));
    await q.drain();

    expect(seen).toEqual(['AAAABBBB', 'CCCCDDDD']);
  });
});
