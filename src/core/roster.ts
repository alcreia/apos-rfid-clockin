/**
 * Card -> name, hand-kept in `data/employees.json`.
 *
 * Deliberately not derived from Absensi: that tab's structure is a moving target
 * and this list is the app's only reason to know a name at all (the 3-second
 * confirmation). A card that is not here is rejected rather than written to Log,
 * so the company's attendance record never gains a row for an unknown card.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isCanonicalUid } from './uid.js';

export type Employee = { name: string };
export type RosterFile = { employees: Record<string, Employee> };

export class Roster {
  private map = new Map<string, Employee>();
  private loadedAt: string | null = null;

  constructor(readonly file: string) {
    this.reload();
  }

  reload(): { size: number; warnings: string[] } {
    const warnings: string[] = [];
    this.map.clear();
    if (!fs.existsSync(this.file)) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ employees: {} }, null, 2));
      warnings.push(`created empty roster at ${this.file}`);
      this.loadedAt = new Date().toISOString();
      return { size: 0, warnings };
    }
    const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as RosterFile;
    for (const [uid, emp] of Object.entries(raw.employees ?? {})) {
      const key = uid.trim().toUpperCase();
      if (!isCanonicalUid(key)) {
        warnings.push(`skipped ${JSON.stringify(uid)}: not an 8-character hex UID`);
        continue;
      }
      if (this.map.has(key)) {
        warnings.push(`skipped duplicate ${key}: already mapped to ${this.map.get(key)?.name}`);
        continue;
      }
      this.map.set(key, { name: emp.name.trim() });
    }
    this.loadedAt = new Date().toISOString();
    return { size: this.map.size, warnings };
  }

  get(uid: string): Employee | null {
    return this.map.get(uid) ?? null;
  }

  get size(): number {
    return this.map.size;
  }

  get lastLoadedAt(): string | null {
    return this.loadedAt;
  }

  list(): Array<{ uid: string; name: string }> {
    return [...this.map.entries()]
      .map(([uid, e]) => ({ uid, ...e }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Plain object, for the pure import/merge functions. */
  snapshot(): Record<string, Employee> {
    return Object.fromEntries(this.map);
  }

  upsert(uid: string, employee: Employee): void {
    this.map.set(uid.trim().toUpperCase(), employee);
  }

  remove(uid: string): boolean {
    return this.map.delete(uid.trim().toUpperCase());
  }

  replaceAll(employees: Record<string, Employee>): void {
    this.map = new Map(
      Object.entries(employees).map(([uid, emp]) => [uid.trim().toUpperCase(), emp] as const),
    );
    this.loadedAt = new Date().toISOString();
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, `${JSON.stringify({ employees: this.snapshot() }, null, 2)}\n`);
  }
}
