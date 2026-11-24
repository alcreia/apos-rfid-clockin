import { describe, expect, it } from 'vitest';
import { mergeRoster, parseRosterText, rosterToCsv } from '../src/core/import.js';
import type { Employee } from '../src/core/roster.js';

describe('parseRosterText', () => {
  it('reads a tab-separated paste from Sheets and skips the header', () => {
    const { rows, warnings } = parseRosterText(
      ['UID\tNAME', '8B17E350\tAyu', 'A401E15B\tSari Dewi'].join('\n'),
    );
    expect(warnings).toContain('line 1: header row skipped');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ line: 2, uid: '8B17E350', name: 'Ayu' });
    expect(rows[1]).toMatchObject({ uid: 'A401E15B', name: 'Sari Dewi' });
  });

  it('ignores a third column and says so', () => {
    const { rows, warnings } = parseRosterText('8B17E350\tAyu\tEMP-001');
    expect(rows[0]).toMatchObject({ uid: '8B17E350', name: 'Ayu' });
    expect(rows[0]).not.toHaveProperty('employeeId');
    expect(warnings).toContain('line 1: columns after the second are ignored');
  });

  it('accepts the reader decimal in the UID column', () => {
    const { rows } = parseRosterText('1357059979,Ayu');
    expect(rows[0]?.uid).toBe('8B17E350');
    expect(rows[0]?.input).toBe('1357059979');
  });

  it('handles quoted names containing commas', () => {
    const { rows } = parseRosterText('8B17E350,"Dewi, Sari"');
    expect(rows[0]).toMatchObject({ uid: '8B17E350', name: 'Dewi, Sari' });
  });

  it('strips quotes in tab-delimited pastes too', () => {
    const { rows } = parseRosterText('8B17E350\t"Dewi, Sari"');
    expect(rows[0]?.name).toBe('Dewi, Sari');
  });

  it('accepts semicolons and skips comments and blank lines', () => {
    const { rows } = parseRosterText(['# roster', '', '8B17E350;Ayu'].join('\n'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Ayu');
  });

  it('reports a bad row without swallowing the good ones', () => {
    const { rows } = parseRosterText(['8B17E350,Ayu', 'NOTACARD,Budi', ',Tanpa UID'].join('\n'));
    expect(rows[0]?.error).toBeUndefined();
    expect(rows[1]?.error).toMatch(/cannot read/);
    expect(rows[2]?.error).toMatch(/missing UID/);
  });

  it('catches the same card twice, even when one row is decimal', () => {
    const { rows } = parseRosterText(['8B17E350,Ayu', '1357059979,Ayu lagi'].join('\n'));
    expect(rows[1]?.error).toMatch(/duplicate card UID 8B17E350/);
  });

  it('refuses an 8-digit UID instead of guessing', () => {
    const { rows } = parseRosterText('54828750,Bambang');
    expect(rows[0]?.error).toMatch(/ambiguous/);
    expect(rows[0]?.uid).toBeNull();
  });

  it('honours hex: and dec: prefixes', () => {
    const hex = parseRosterText('hex:54828750,Bambang').rows[0];
    expect(hex?.uid).toBe('54828750');
    expect(hex?.error).toBeUndefined();

    const dec = parseRosterText('dec:42962693,Example Name').rows[0];
    expect(dec?.uid).toBe('058F8F02');
  });
});

describe('mergeRoster', () => {
  const current: Record<string, Employee> = { '8B17E350': { name: 'Ayu' } };

  it('adds, updates and leaves alone', () => {
    const parsed = parseRosterText(
      ['8B17E350,Ayu', 'A401E15B,Budi', '5BE101A4,Putri'].join('\n'),
    );
    const result = mergeRoster(current, parsed.rows, 'merge');
    const byUid = Object.fromEntries(result.applied.map((r) => [r.uid, r.status]));

    expect(byUid).toMatchObject({
      '8B17E350': 'unchanged',
      A401E15B: 'added',
      '5BE101A4': 'added',
    });
    expect(Object.keys(result.next)).toHaveLength(3);
  });

  it('treats a changed name as an update', () => {
    const parsed = parseRosterText('8B17E350,Ayu Lestari');
    const result = mergeRoster(current, parsed.rows, 'merge');
    expect(result.counts.updated).toBe(1);
    expect(result.next['8B17E350']?.name).toBe('Ayu Lestari');
  });

  it('replace mode drops everyone not in the paste', () => {
    const parsed = parseRosterText('A401E15B,Budi');
    const result = mergeRoster(current, parsed.rows, 'replace');
    expect(Object.keys(result.next)).toEqual(['A401E15B']);
    expect(result.counts.removed).toBe(1);
  });

  it('never lets an errored row through, even in replace mode', () => {
    const parsed = parseRosterText('NOTACARD,Budi');
    const result = mergeRoster(current, parsed.rows, 'replace');
    expect(result.next).toEqual({});
    expect(result.counts.errors).toBe(1);
  });

  it('warns when two cards carry the same name', () => {
    const parsed = parseRosterText(['8B17E350,Budi', 'A401E15B,Budi'].join('\n'));
    const result = mergeRoster({}, parsed.rows, 'merge');
    expect(result.warnings.join(' ')).toMatch(/two cards share the name "Budi"/);
  });
});

describe('rosterToCsv', () => {
  it('round-trips through the parser', () => {
    const employees: Record<string, Employee> = {
      '8B17E350': { name: 'Dewi, Sari' },
      A401E15B: { name: 'Putri "T" Rahma' },
      '54828750': { name: 'Bambang' },
    };
    const csv = rosterToCsv(employees);
    expect(csv.split('\n')[0]).toBe('uid,name');
    // The all-digit UID is marked so the file survives a re-import.
    expect(csv).toContain('hex:54828750,Bambang');

    const { rows } = parseRosterText(csv);
    const back = Object.fromEntries(rows.map((r) => [r.uid, r.name]));
    expect(back['8B17E350']).toBe('Dewi, Sari');
    expect(back['A401E15B']).toBe('Putri "T" Rahma');
    expect(back['54828750']).toBe('Bambang');
  });
});
