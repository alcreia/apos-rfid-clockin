/**
 * Sheet operations, without opening Sheets.
 *
 *   tsx scripts/sheet.ts tail [n]                        last n rows of the Log
 *   tsx scripts/sheet.ts delete <row> --expect-uid=HEX    remove one row, guarded
 *
 * `delete` refuses unless column F of that row still holds the UID you name, so a
 * stale row number cannot destroy somebody's real clock-in.
 */
import fs from 'node:fs';
import { JWT } from 'google-auth-library';
import { serialToYmd } from '../src/core/day.js';
import { columnLetter, findColumns, parseLogRow, type ColumnMap } from '../src/sheets/preflight.js';

process.loadEnvFile('.env');

const sheetId = process.env.SHEET_ID;
const tab = process.env.SHEET_TAB ?? 'Log';
if (!sheetId) {
  console.error('SHEET_ID is not set in .env');
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);

const creds = JSON.parse(fs.readFileSync('secrets/sa.json', 'utf8')) as {
  client_email: string;
  private_key: string;
};
const jwt = new JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const token = (await jwt.getAccessToken()).token;
if (!token) throw new Error('no access token');

const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
const auth = { Authorization: `Bearer ${token}` };
const range = (a1: string) => encodeURIComponent(`${tab}!${a1}`);

/** Column layout comes from the header row — the live Log has RFID in B, not F. */
async function columns(): Promise<ColumnMap> {
  const res = await fetch(`${base}/values/${range('A1:Z1')}`, { headers: auth });
  if (!res.ok) {
    console.error(`could not read the header row: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const header = ((await res.json()) as { values?: unknown[][] }).values?.[0] ?? [];
  const found = findColumns(header);
  if ('error' in found) {
    console.error(`${tab} header: ${found.error}`);
    process.exit(1);
  }
  return found;
}

const lastCol = async (): Promise<string> => {
  const c = await columns();
  return columnLetter(Math.max(c.timestamp, c.uid));
};

function roster(): Record<string, string> {
  try {
    const file = JSON.parse(fs.readFileSync('data/employees.json', 'utf8')) as {
      employees: Record<string, { name: string }>;
    };
    return Object.fromEntries(Object.entries(file.employees).map(([uid, e]) => [uid, e.name]));
  } catch {
    return {};
  }
}

if (command === 'compare') {
  const lastRow = Number(args[0] ?? 200);
  const res = await fetch(
    `${base}/values/${encodeURIComponent(`Absensi!B4:C${lastRow}`)}?valueRenderOption=UNFORMATTED_VALUE`,
    { headers: auth },
  );
  if (!res.ok) {
    console.error(`read failed ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const rows = ((await res.json()) as { values?: unknown[][] }).values ?? [];

  const sheet = new Map<string, string>();
  for (const row of rows) {
    const uid = String(row[0] ?? '').trim().toUpperCase();
    const name = String(row[1] ?? '').trim();
    if (uid && name) sheet.set(uid, name);
  }
  const mine = roster();

  // When was each UID last seen in the Log? A card last used in 2023 was probably
  // reassigned; a card used last week means the *other* list is stale.
  const logRes = await fetch(
    `${base}/values/${encodeURIComponent('Log!A:B')}?valueRenderOption=UNFORMATTED_VALUE`,
    { headers: auth },
  );
  const logRows = logRes.ok ? (((await logRes.json()) as { values?: unknown[][] }).values ?? []) : [];
  const lastSeen = new Map<string, number>();
  for (const row of logRows) {
    const serial = Number(row[0]);
    const uid = String(row[1] ?? '').trim().toUpperCase();
    if (!Number.isFinite(serial) || !uid) continue;
    const prev = lastSeen.get(uid);
    if (prev === undefined || serial > prev) lastSeen.set(uid, serial);
  }
  const last = (uid: string): string => {
    const serial = lastSeen.get(uid);
    if (serial === undefined) return 'never in the Log';
    return `last Log row ${serialToYmd(serial)}`;
  };

  const onlySheet = [...sheet].filter(([uid]) => !(uid in mine));
  const onlyLocal = Object.entries(mine).filter(([uid]) => !sheet.has(uid));
  const renamed = [...sheet].filter(([uid, name]) => uid in mine && mine[uid] !== name);

  console.log(`Absensi!B:C has ${sheet.size} UIDs · data/employees.json has ${Object.keys(mine).length}`);
  console.log(`\nin Absensi but NOT in the local roster — they cannot clock in (${onlySheet.length}):`);
  for (const [uid, name] of onlySheet) console.log(`   ${uid}  ${name.padEnd(18)} ${last(uid)}`);
  console.log(`\nin the local roster but NOT in Absensi — their taps write a row nothing displays (${onlyLocal.length}):`);
  for (const [uid, name] of onlyLocal) console.log(`   ${uid}  ${name.padEnd(18)} ${last(uid)}`);
  console.log(`\nsame UID, different name (${renamed.length}):`);
  for (const [uid, name] of renamed) {
    console.log(`   ${uid}  Absensi="${name}"  local="${mine[uid]}"  ${last(uid)}`);
  }
  process.exit(0);
}

if (command === 'formulas') {
  const a1Range = args.find((a) => a.startsWith('--range='))?.split('=')[1] ?? 'A1:Z3';
  const which = args.find((a) => a.startsWith('--tab='))?.split('=')[1] ?? tab;
  const url = `${base}/values/${encodeURIComponent(`${which}!${a1Range}`)}?valueRenderOption=FORMULA`;
  const res = await fetch(url, { headers: auth });
  if (!res.ok) {
    console.error(`read failed ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const body = (await res.json()) as { range?: string; values?: unknown[][] };
  console.log(`${which}!${a1Range} -> ${body.range ?? '?'}`);
  (body.values ?? []).forEach((row, i) => {
    console.log(`  row ${i + 1}:`);
    row.forEach((cell, j) => {
      if (String(cell ?? '').trim() !== '') console.log(`    ${columnLetter(j)}: ${String(cell)}`);
    });
  });
  process.exit(0);
}

if (command === 'get') {
  const a1 = args[0] ?? 'A1:Z3';
  const res = await fetch(`${base}/values/${range(a1)}?valueRenderOption=UNFORMATTED_VALUE`, {
    headers: auth,
  });
  if (!res.ok) {
    console.error(`read failed ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const body = (await res.json()) as { range?: string; values?: unknown[][] };
  console.log(`${tab}!${a1} -> ${body.range ?? '?'}`);
  for (const row of body.values ?? []) console.log('  ', JSON.stringify(row));
  process.exit(0);
}

if (command === 'raw') {
  const n = Number(args[0] ?? 5);
  const res = await fetch(`${base}/values/${range('A:F')}?valueRenderOption=UNFORMATTED_VALUE`, {
    headers: auth,
  });
  if (!res.ok) {
    console.error(`read failed ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const rows = ((await res.json()) as { values?: unknown[][] }).values ?? [];
  console.log(`first ${n}:`);
  for (const row of rows.slice(0, n)) console.log('  ', JSON.stringify(row));
  console.log(`last ${n}:`);
  for (const row of rows.slice(-n)) console.log('  ', JSON.stringify(row));
  process.exit(0);
}

if (command === 'tail') {
  const n = Number(args[0] ?? 10);
  const cols = await columns();
  const res = await fetch(`${base}/values/${range(`A:${await lastCol()}`)}?valueRenderOption=UNFORMATTED_VALUE`, {
    headers: auth,
  });
  if (!res.ok) {
    console.error(`read failed ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const rows = ((await res.json()) as { values?: unknown[][] }).values ?? [];
  const names = roster();
  const from = Math.max(0, rows.length - n);
  console.log(
    `${rows.length} rows in ${tab} (timestamp=${columnLetter(cols.timestamp)}, uid=${columnLetter(cols.uid)}); showing ${from + 1}..${rows.length}`,
  );
  for (let i = from; i < rows.length; i += 1) {
    const row = rows[i] ?? [];
    const parsed = parseLogRow(row, cols);
    const uid = parsed?.uid ?? String(row[cols.uid] ?? '');
    const who = names[uid] ?? (uid ? '(not in roster)' : '');
    console.log(
      `  ${String(i + 1).padStart(6)}  ${parsed ? `${parsed.day} ${parsed.time}` : String(row[0] ?? '—').padEnd(19)}  ${String(uid || '—').padEnd(9)} ${who}`,
    );
  }
  process.exit(0);
}

if (command === 'delete') {
  const row = Number(args[0]);
  const expect = args.find((a) => a.startsWith('--expect-uid='))?.split('=')[1]?.toUpperCase();
  if (!Number.isInteger(row) || row < 2 || !expect) {
    console.error('usage: tsx scripts/sheet.ts delete <row> --expect-uid=<HEX>');
    process.exit(1);
  }

  const cols = await columns();
  const last = await lastCol();
  const current = (await (
    await fetch(`${base}/values/${range(`A${row}:${last}${row}`)}`, { headers: auth })
  ).json()) as {
    values?: unknown[][];
  };
  const values = current.values?.[0] ?? [];
  const uid = String(values[cols.uid] ?? '').toUpperCase();
  if (uid !== expect) {
    console.error(`REFUSING: row ${row} holds UID "${uid}", not "${expect}":`, JSON.stringify(values));
    process.exit(1);
  }

  const meta = (await (await fetch(`${base}?fields=sheets.properties`, { headers: auth })).json()) as {
    sheets?: Array<{ properties?: { title?: string; sheetId?: number } }>;
  };
  const numericId = meta.sheets?.find((s) => s.properties?.title === tab)?.properties?.sheetId;
  if (numericId === undefined) throw new Error(`no tab named ${tab}`);

  const del = await fetch(`${base}:batchUpdate`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          deleteDimension: {
            range: { sheetId: numericId, dimension: 'ROWS', startIndex: row - 1, endIndex: row },
          },
        },
      ],
    }),
  });
  if (!del.ok) {
    console.error(`delete failed ${del.status}: ${await del.text()}`);
    process.exit(1);
  }
  const after = (await (await fetch(`${base}/values/${range(`A${row}:F${row}`)}`, { headers: auth })).json()) as {
    values?: unknown[][];
  };
  console.log(`deleted row ${row} (was uid ${expect}); that row now reads: ${after.values?.[0]?.length ? JSON.stringify(after.values[0]) : '(empty)'}`);
  process.exit(0);
}

console.error('usage:\n  tsx scripts/sheet.ts tail [n]\n  tsx scripts/sheet.ts delete <row> --expect-uid=<HEX>');
process.exit(1);
