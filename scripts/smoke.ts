/**
 * The one thing that cannot be tested locally: how Google parses what we write.
 *
 *   npm run smoke -- --check-only     read-only: token, tab, timezone, column layout
 *   npm run smoke                     append one row, read it back, verify
 *
 * `--check-only` is safe on the live sheet at any time; the full run writes one row
 * with the synthetic UID FFFFFFFF for you to delete.
 *
 * Four silent failures this catches, all of which look fine on screen:
 *   - the service account cannot see the file
 *   - the tab is named something else
 *   - the spreadsheet timezone reads naive timestamps differently
 *   - the UID column is not where the app assumed (this workbook has it in B, not F)
 */
import fs from 'node:fs';
import path from 'node:path';
import { JWT } from 'google-auth-library';
import { DEFAULT_TZ, logTimestamp } from '../src/core/day.js';
import {
  columnLetter,
  compareWritten,
  findColumns,
  findTab,
  parseLogRow,
  sheetTimezone,
  spreadsheetAccessHint,
  timezoneProblem,
  type ColumnMap,
  type SpreadsheetMeta,
} from '../src/sheets/preflight.js';

const checkOnly = process.argv.includes('--check-only');

if (fs.existsSync(path.join(process.cwd(), '.env'))) {
  process.loadEnvFile(path.join(process.cwd(), '.env'));
}

const sheetId = process.env.SHEET_ID;
const tab = process.env.SHEET_TAB ?? 'Log';
const tz = process.env.TZ_NAME ?? DEFAULT_TZ;
const keyPath = path.resolve(process.cwd(), process.env.SA_KEY_PATH ?? 'secrets/sa.json');
const UID = 'FFFFFFFF';

function die(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

if (!sheetId) die('SHEET_ID is not set in .env');

if (!fs.existsSync(keyPath)) {
  die(`no service-account key at ${keyPath}
  Google Cloud → create a service account → add a JSON key → save it there.
  Then share the spreadsheet with the account's email address as Editor.`);
}

const creds = JSON.parse(fs.readFileSync(keyPath, 'utf8')) as {
  client_email?: string;
  private_key?: string;
};
if (!creds.client_email || !creds.private_key) die(`${keyPath} is not a service-account JSON key`);

const jwt = new JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

console.log(`service account : ${creds.client_email}`);
console.log(`spreadsheet     : ${sheetId}`);
console.log(`tab / timezone  : ${tab} / ${tz}${checkOnly ? '   (check only, no writes)' : ''}`);

let token: string;
try {
  const res = await jwt.getAccessToken();
  if (!res.token) die(`could not obtain an access token for ${creds.client_email}`);
  token = res.token;
  console.log('access token    : ok');
} catch (error) {
  die(`authentication failed — check that the key belongs to a live service account.\n  ${String(error)}`);
}

const base = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
const auth = { Authorization: `Bearer ${token}` };
const a1 = (range: string) => encodeURIComponent(`${tab}!${range}`);

// --- 1. the file is visible, the tab exists, the timezone is right ------------
const metaRes = await fetch(`${base}?fields=properties.title,properties.timeZone,sheets.properties.title`, {
  headers: auth,
});
if (!metaRes.ok) {
  const body = await metaRes.text();
  if (metaRes.status === 403 || metaRes.status === 404) {
    die(`${spreadsheetAccessHint(metaRes.status, sheetId, creds.client_email)}\n  ${body}`);
  }
  die(`could not read the spreadsheet (${metaRes.status}): ${body}`);
}

const meta = (await metaRes.json()) as SpreadsheetMeta;
const tabs = (meta.sheets ?? []).map((s) => s.properties?.title).filter(Boolean);
console.log(`spreadsheet     : "${meta.properties?.title ?? '?'}" · tabs: ${tabs.join(', ')}`);

if (!findTab(meta, tab)) die(`there is no tab named "${tab}" — found: ${tabs.join(', ')}`);

const tzProblem = timezoneProblem(sheetTimezone(meta), tz);
if (tzProblem) {
  die(`${tzProblem}
  Fix: spreadsheet → File → Settings → Time zone → set ${tz}.
  Until then every row this app writes lands hours away from the tap.`);
}
console.log(`timezone        : ${sheetTimezone(meta)} ✓`);

// --- 2. the columns are where the app thinks they are -----------------------
const headerRes = await fetch(`${base}/values/${a1('A1:Z1')}`, { headers: auth });
if (!headerRes.ok) die(`could not read the header row: ${headerRes.status} ${await headerRes.text()}`);
const header = ((await headerRes.json()) as { values?: unknown[][] }).values?.[0] ?? [];

const columns = findColumns(header);
if ('error' in columns) {
  die(`${tab} header: ${columns.error}
  The app reads the column layout from this row, so it must name both fields.`);
}
const cols: ColumnMap = columns;
const lastCol = columnLetter(Math.max(cols.timestamp, cols.uid));
const tableUrl = `${base}/values/${a1(`A:${lastCol}`)}`;

console.log(
  `columns         : timestamp=${columnLetter(cols.timestamp)} uid=${columnLetter(cols.uid)}   (from the header: ${JSON.stringify(header)})`,
);

if (checkOnly) {
  console.log('\n✓ readable, correct tab, correct timezone, columns located. Nothing was written.');
  process.exit(0);
}

// --- 3. write one row, and prove Google parsed it as a datetime --------------
const stamp = logTimestamp(new Date(), tz);
const width = Math.max(cols.timestamp, cols.uid) + 1;
const cells = Array<string>(width).fill('');
cells[cols.timestamp] = stamp;
cells[cols.uid] = UID;

console.log(`\nwriting         : "${stamp}" uid ${UID}`);

const write = await fetch(`${tableUrl}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ values: [cells] }),
});
if (!write.ok) die(`append failed ${write.status}: ${await write.text()}`);
const written = (await write.json()) as { updates?: { updatedRange?: string } };
const range = written.updates?.updatedRange ?? '(unknown range)';
console.log(`appended at     : ${range}`);

const read = await fetch(`${tableUrl}?valueRenderOption=UNFORMATTED_VALUE`, { headers: auth });
if (!read.ok) die(`read-back failed ${read.status}: ${await read.text()}`);
const rows = ((await read.json()) as { values?: unknown[][] }).values ?? [];

// Match on the synthetic UID rather than trusting "last row": someone may be
// clocking in at the kiosk while this runs.
const mine = [...rows].reverse().find((row) => String(row[cols.uid] ?? '').toUpperCase() === UID);
const parsed = mine ? parseLogRow(mine, cols) : null;
console.log(`read back       : ${parsed ? `${parsed.day} ${parsed.time} uid ${parsed.uid}` : 'not found'}`);

const problems = compareWritten({ timestamp: stamp, uid: UID }, parsed);
if (problems.length > 0) {
  console.error('\n✗ FAILED');
  for (const p of problems) console.error(`   - ${p}`);
  console.error(`\nThe row is at ${range}. Delete it, fix the spreadsheet timezone, and re-run.`);
  process.exit(1);
}

console.log('\n✓ Google parsed the value as the exact datetime we sent.');
console.log(`  Delete the smoke row at ${range} before go-live.`);
