/**
 * The first-tap-of-the-day rule.
 *
 * Absensi looks up the *last* Log entry for an employee; the business rule is that
 * the *first* tap wins. The only thing making those agree is that this app writes at
 * most one row per (Day, Card). Without it, a stray second tap moves the recorded
 * arrival later and can turn an on-time arrival into a late one.
 */
export class DedupeIndex {
  private seen = new Set<string>();

  private static key(day: string, uid: string): string {
    return `${day}|${uid}`;
  }

  has(day: string, uid: string): boolean {
    return this.seen.has(DedupeIndex.key(day, uid));
  }

  add(day: string, uid: string): void {
    this.seen.add(DedupeIndex.key(day, uid));
  }

  /** Rebuild from durable taps at boot. */
  load(entries: Iterable<{ day: string; uid: string }>): void {
    for (const e of entries) this.add(e.day, e.uid);
  }

  get size(): number {
    return this.seen.size;
  }
}
