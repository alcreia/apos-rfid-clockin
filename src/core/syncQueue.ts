/**
 * The queue between the ledger and the Log tab.
 *
 * `spreadsheets.values.append` is not idempotent: a call that times out may well
 * have been applied. So a retry after an ambiguous failure first asks the sheet
 * whether that (Day, Card) row already exists, and swallows the item if it does.
 */
import type { TapRecord } from './ledger.js';

export interface ClockInSink {
  append(row: { timestamp: string; uid: string }): Promise<void>;
  /** True when the sheet already holds a row for this Day + Card. */
  exists(day: string, uid: string): Promise<boolean>;
}

export type QueueOptions = {
  backoffMs?: number[];
  maxAttempts?: number;
  onSynced?: (id: string) => void;
  onFailed?: (item: TapRecord, error: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
};

type Item = TapRecord & { attempts: number };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class SyncQueue {
  private items: Item[] = [];
  private current: Promise<void> | null = null;
  private readonly backoff: number[];
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly sink: ClockInSink,
    private readonly opts: QueueOptions = {},
  ) {
    this.backoff = opts.backoffMs ?? [1_000, 5_000, 30_000, 120_000, 300_000];
    this.maxAttempts = opts.maxAttempts ?? this.backoff.length + 1;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  get pendingCount(): number {
    return this.items.length;
  }

  enqueue(record: TapRecord): void {
    this.items.push({ ...record, attempts: 0 });
    void this.drain();
  }

  /** Processes until empty (or until items exhaust their attempts). Awaitable in tests. */
  drain(): Promise<void> {
    // A caller that arrives during a run joins it rather than returning early;
    // enqueue() items are picked up by the loop, which re-checks `items` each pass.
    if (this.current) return this.current;
    this.current = this.run().finally(() => {
      this.current = null;
      if (this.items.length > 0) void this.drain();
    });
    return this.current;
  }

  private async run(): Promise<void> {
    while (this.items.length > 0) {
      const item = this.items[0]!;
      try {
        if (item.attempts > 0 && (await this.sink.exists(item.day, item.uid))) {
          // An earlier attempt already landed; do not append a second row.
          this.items.shift();
          this.opts.onSynced?.(item.id);
          continue;
        }
        await this.sink.append({ timestamp: item.timestamp, uid: item.uid });
        this.items.shift();
        this.opts.onSynced?.(item.id);
      } catch (error) {
        item.attempts += 1;
        if (item.attempts >= this.maxAttempts) {
          this.items.shift();
          this.opts.onFailed?.(item, error);
          continue;
        }
        const wait = this.backoff[Math.min(item.attempts - 1, this.backoff.length - 1)]!;
        await this.sleep(wait);
      }
    }
  }
}
