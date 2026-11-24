/**
 * Turning a pasted list into a roster.
 *
 * The list arrives from anywhere: a sheet export, a printed label sheet typed by
 * hand, or a scratchpad filled in while tapping cards. So the parser is forgiving
 * about layout (tab, comma, semicolon, runs of spaces) and about the UID's radix —
 * `decode()` accepts both the reader's decimal and the canonical hex, which is what
 * lets a list of print-format numbers be imported before the reader exists.
 *
 * Nothing here touches the filesystem: parse and merge are pure, so the /dev page can
 * preview the exact result before it overwrites a roster that took an hour to type.
 */
import { decodeUid, isCanonicalUid } from './uid.js';
import type { Employee } from './roster.js';

export type ParsedRow = {
  line: number;
  input: string; // the UID cell exactly as typed
  uid: string | null; // canonical, when it could be decoded
  name: string;
  error?: string;
};

export type ParseResult = { rows: ParsedRow[]; warnings: string[] };

export type AppliedRow = ParsedRow & {
  status: 'added' | 'updated' | 'unchanged' | 'error';
};

export type MergeResult = {
  next: Record<string, Employee>;
  applied: AppliedRow[];
  errors: { line: number; message: string }[];
  warnings: string[];
  counts: { added: number; updated: number; unchanged: number; removed: number; errors: number };
};

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

/** A cell may arrive quoted even outside CSV (people paste from everywhere). */
function unquote(cell: string): string {
  const trimmed = cell.trim();
  const m = /^"(.*)"$/s.exec(trimmed);
  return (m?.[1] ?? trimmed).replace(/""/g, '"').trim();
}

function splitCells(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map(unquote);
  if (line.includes(',')) return splitCsvLine(line);
  if (line.includes(';')) return line.split(';').map(unquote);
  return line.split(/\s{2,}/).map(unquote);
}

const HEADER_UID = /^(uid|card|card\s*uid|rfid|id)$/i;
const HEADER_NAME = /name|nama|employee/i;

export function parseRosterText(text: string): ParseResult {
  const rows: ParsedRow[] = [];
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/);
  let headerSkipped = false;

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const cells = splitCells(trimmed);
    if (!headerSkipped && HEADER_UID.test(cells[0] ?? '') && HEADER_NAME.test(cells[1] ?? '')) {
      headerSkipped = true;
      warnings.push(`line ${lineNo}: header row skipped`);
      return;
    }

    const input = (cells[0] ?? '').trim();
    const name = (cells[1] ?? '').trim();

    if (!input) {
      rows.push({ line: lineNo, input, uid: null, name, error: 'missing UID in the first column' });
      return;
    }
    if (!name) {
      rows.push({ line: lineNo, input, uid: null, name, error: 'missing name in the second column' });
      return;
    }

    const decoded = decodeUid(input);
    if ('error' in decoded) {
      rows.push({ line: lineNo, input, uid: null, name, error: decoded.error });
      return;
    }

    if (cells.length > 2) warnings.push(`line ${lineNo}: columns after the second are ignored`);
    rows.push({ line: lineNo, input, uid: decoded.uid, name });
  });

  const seen = new Map<string, number>();
  for (const row of rows) {
    if (!row.uid) continue;
    const first = seen.get(row.uid);
    if (first !== undefined) {
      row.error = `duplicate card UID ${row.uid} (already on line ${first})`;
    } else seen.set(row.uid, row.line);
  }

  return { rows, warnings };
}

export function mergeRoster(
  current: Record<string, Employee>,
  rows: ParsedRow[],
  mode: 'merge' | 'replace',
): MergeResult {
  const next: Record<string, Employee> = mode === 'replace' ? {} : { ...current };
  const applied: AppliedRow[] = [];
  const errors: { line: number; message: string }[] = [];
  const warnings: string[] = [];
  const counts = { added: 0, updated: 0, unchanged: 0, removed: 0, errors: 0 };

  for (const row of rows) {
    if (row.error || !row.uid) {
      const message = row.error ?? 'invalid row';
      applied.push({ ...row, status: 'error' });
      errors.push({ line: row.line, message });
      counts.errors += 1;
      continue;
    }

    const previous = current[row.uid];
    const incoming: Employee = { name: row.name };

    // Compared against the roster *before* the import, so `replace` mode still
    // distinguishes a renamed card from a new one.
    if (!previous) {
      next[row.uid] = incoming;
      applied.push({ ...row, status: 'added' });
      counts.added += 1;
    } else if (previous.name !== incoming.name) {
      next[row.uid] = incoming;
      applied.push({ ...row, status: 'updated' });
      counts.updated += 1;
    } else {
      next[row.uid] = incoming;
      applied.push({ ...row, status: 'unchanged' });
      counts.unchanged += 1;
    }
  }

  if (mode === 'replace') {
    for (const uid of Object.keys(current)) {
      if (!(uid in next)) {
        counts.removed += 1;
        warnings.push(`removed ${uid} (${current[uid]?.name ?? 'unknown'})`);
      }
    }
  }

  const byName = new Map<string, { display: string; uids: string[] }>();
  for (const [uid, emp] of Object.entries(next)) {
    const key = emp.name.trim().toLowerCase();
    const entry = byName.get(key) ?? { display: emp.name.trim(), uids: [] };
    entry.uids.push(uid);
    byName.set(key, entry);
  }
  for (const { display, uids } of byName.values()) {
    if (uids.length > 1) warnings.push(`two cards share the name "${display}": ${uids.join(', ')}`);
  }

  return { next, applied, errors, warnings, counts };
}

/** `uid,name` — the format the parser round-trips, ready for the next import. */
export function rosterToCsv(employees: Record<string, Employee>): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ['uid,name'];
  for (const uid of Object.keys(employees).sort()) {
    if (!isCanonicalUid(uid)) continue;
    const e = employees[uid]!;
    // An 8-digit UID is both valid hex and a valid reader decimal, so mark it as hex
    // or this file would not survive a re-import.
    const cell = /^\d{8}$/.test(uid) ? `hex:${uid}` : uid;
    lines.push([cell, esc(e.name)].join(','));
  }
  return `${lines.join('\n')}\n`;
}
