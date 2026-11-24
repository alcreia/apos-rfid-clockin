/**
 * The local append-only ledger: the thing this app trusts (ADR-0001).
 *
 * One JSON object per line. Every accepted tap is appended and fsynced before the
 * kiosk is told anything, so a power cut between "tap accepted" and "Google
 * acknowledged" cannot lose an attendance record. Sync state is recorded by
 * appending further lines, so the file is never rewritten.
 */
import fs from 'node:fs';
import path from 'node:path';

export type TapRecord = {
  type: 'tap';
  id: string;
  at: string; // ISO instant
  day: string; // YYYY-MM-DD, office local
  uid: string; // canonical 8-hex
  uidRaw: string; // exactly what arrived from the reader, for forensics
  name: string;
  timestamp: string; // naive local, exactly what goes to Log!A
};

export type SyncedRecord = { type: 'synced'; id: string; at: string };
export type LedgerRecord = TapRecord | SyncedRecord;

export class Ledger {
  constructor(readonly file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  append(record: LedgerRecord): void {
    const fd = fs.openSync(this.file, 'a');
    try {
      fs.writeSync(fd, `${JSON.stringify(record)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }

  read(): LedgerRecord[] {
    if (!fs.existsSync(this.file)) return [];
    const out: LedgerRecord[] = [];
    for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as LedgerRecord);
      } catch {
        // A torn final line from an interrupted write: drop it, the rest is intact.
      }
    }
    return out;
  }

  load(): { taps: TapRecord[]; synced: Set<string> } {
    const taps: TapRecord[] = [];
    const synced = new Set<string>();
    for (const r of this.read()) {
      if (r.type === 'tap') taps.push(r);
      else synced.add(r.id);
    }
    return { taps, synced };
  }

  /** Taps accepted but not yet acknowledged by the sheet, oldest first. */
  unsynced(): TapRecord[] {
    const { taps, synced } = this.load();
    return taps.filter((t) => !synced.has(t.id));
  }
}
