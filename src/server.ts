import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { clockTime, localDay, logTimestamp, DEFAULT_TZ } from './core/day.js';
import { DedupeIndex } from './core/dedupe.js';
import { Ledger, type TapRecord } from './core/ledger.js';
import { Roster } from './core/roster.js';
import { SyncQueue } from './core/syncQueue.js';
import { decode, explain } from './core/uid.js';
import { mergeRoster, parseRosterText, rosterToCsv } from './core/import.js';
import { GoogleSheetsSink, StubSink } from './sheets/sheets.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// Fail with an instruction rather than a stack trace on an older runtime: this needs
// process.loadEnvFile, global fetch, AbortSignal.timeout and full-ICU timezones.
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (!Number.isFinite(nodeMajor) || nodeMajor < 22) {
  console.error(
    `Node.js 22 or newer is required (this is ${process.versions.node}).\n` +
      'Install the LTS build from nodejs.org, then delete node_modules and run npm ci again.',
  );
  process.exit(1);
}

const ENV_FILE = path.join(ROOT, '.env');
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const DATA = path.join(ROOT, 'data');
const DIST = path.join(ROOT, 'dist');
const TAB = process.env.SHEET_TAB ?? 'Log';
const DEV = process.env.DEV !== '0';
const MODE = process.env.SHEETS_MODE === 'live' ? 'live' : 'stub';

// Both of these are hand-edited in .env, so a typo must say what is wrong rather than
// surfacing later as a socket error or a RangeError deep inside a timezone call.
const TZ = process.env.TZ_NAME ?? DEFAULT_TZ;
try {
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ });
} catch {
  console.error(`TZ_NAME is not a known timezone: ${JSON.stringify(TZ)} — use an IANA name such as Asia/Jakarta`);
  process.exit(1);
}

const PORT = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`PORT must be a whole number from 1 to 65535 (got ${JSON.stringify(process.env.PORT)})`);
  process.exit(1);
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required when SHEETS_MODE=live`);
  return v;
}

const ledger = new Ledger(path.join(DATA, 'taps.jsonl'));
const roster = new Roster(path.join(DATA, 'employees.json'));
const rejectedFile = path.join(DATA, 'rejected.jsonl');

const sink =
  MODE === 'live'
    ? new GoogleSheetsSink({
        sheetId: required('SHEET_ID'),
        tab: TAB,
        keyPath: path.resolve(ROOT, process.env.SA_KEY_PATH ?? 'secrets/sa.json'),
      })
    : new StubSink(path.join(DATA, 'stub-sheet.jsonl'));

const queue = new SyncQueue(sink, {
  onSynced: (id) => ledger.append({ type: 'synced', id, at: new Date().toISOString() }),
  onFailed: (item, error) => console.error('[sync] gave up on', item.id, error),
});

// --- boot replay: the ledger is the truth, everything else is derived from it ---
const { taps } = ledger.load();
const dedupe = new DedupeIndex();
dedupe.load(taps);
const firstTap = new Map<string, TapRecord>();
for (const t of taps) firstTap.set(`${t.day}|${t.uid}`, t);
for (const t of ledger.unsynced()) queue.enqueue(t);

function recordRejection(raw: string, reason: string): void {
  const line = JSON.stringify({ at: new Date().toISOString(), raw, reason, decoded: explain(raw) });
  fs.appendFileSync(rejectedFile, `${line}\n`);
}

const app = express();
app.disable('x-powered-by');

/**
 * The API has no authentication; it relies on being reachable only from this machine.
 * That still leaves any page open in the kiosk's browser able to POST to localhost, so
 * refuse anything that announces a foreign Origin. (A JSON body also forces a CORS
 * preflight, which this server never answers — this is the belt to that braces.)
 */
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)) {
    res.status(403).json({ error: 'cross-origin request refused' });
    return;
  }
  next();
});

app.use(express.json({ limit: '2kb' }));

app.get('/api/health', (_req, res) => {
  const { taps: all, synced } = ledger.load();
  const today = localDay(new Date(), TZ);
  res.json({
    ok: true,
    now: new Date().toISOString(),
    time: clockTime(new Date(), TZ),
    tz: TZ,
    mode: MODE,
    tab: TAB,
    rosterSize: roster.size,
    pending: queue.pendingCount,
    // Accepted but not in the sheet — includes taps whose queue retries were exhausted,
    // which `pending` alone would report as a healthy zero.
    unsynced: all.filter((t) => !synced.has(t.id)).length,
    tapsToday: all.filter((t) => t.day === today).length,
  });
});

app.get('/api/state', (_req, res) => {
  const now = new Date();
  const { taps: all, synced } = ledger.load();
  res.json({
    now: now.toISOString(),
    day: localDay(now, TZ),
    time: clockTime(now, TZ),
    mode: MODE,
    pending: queue.pendingCount,
    unsynced: all.filter((t) => !synced.has(t.id)).length,
    roster: { size: roster.size, loadedAt: roster.lastLoadedAt },
  });
});

app.post('/api/tap', (req, res) => {
  const raw = String((req.body as { raw?: unknown })?.raw ?? '');
  const now = new Date();
  const decoded = decode(raw);

  if (!decoded) {
    recordRejection(raw, 'undecodable');
    res.status(400).json({ status: 'unknown', message: 'Unidentified card' });
    return;
  }

  const employee = roster.get(decoded.uid);
  if (!employee) {
    recordRejection(raw, `card ${decoded.uid} not in roster`);
    res.status(404).json({ status: 'unknown', message: 'Unidentified card', uid: decoded.uid });
    return;
  }

  const day = localDay(now, TZ);
  const key = `${day}|${decoded.uid}`;

  if (dedupe.has(day, decoded.uid)) {
    const first = firstTap.get(key);
    res.json({
      status: 'duplicate',
      name: employee.name,
      uid: decoded.uid,
      time: first ? first.timestamp.slice(11, 16) : null,
    });
    return;
  }

  const record: TapRecord = {
    type: 'tap',
    id: crypto.randomUUID(),
    at: now.toISOString(),
    day,
    uid: decoded.uid,
    uidRaw: raw.trim(),
    name: employee.name,
    timestamp: logTimestamp(now, TZ),
  };

  ledger.append(record); // fsynced before anyone is told anything
  dedupe.add(day, decoded.uid);
  firstTap.set(key, record);
  queue.enqueue(record);

  res.json({ status: 'recorded', name: employee.name, uid: decoded.uid, time: clockTime(now, TZ), day });
});

app.post('/api/roster/reload', (_req, res) => {
  const result = roster.reload();
  res.json(result);
});

if (DEV) {
  app.get('/api/dev/roster', (_req, res) => {
    res.json({ size: roster.size, loadedAt: roster.lastLoadedAt, employees: roster.list() });
  });

  app.get('/api/dev/rejected', (_req, res) => {
    if (!fs.existsSync(rejectedFile)) return res.json({ entries: [] });
    const entries = fs
      .readFileSync(rejectedFile, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(-25)
      .reverse()
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return { raw: l, reason: 'unparsed' };
        }
      });
    res.json({ entries });
  });

  app.post('/api/dev/enroll', (req, res) => {
    const { raw, name } = (req.body ?? {}) as { raw?: string; name?: string };
    if (!raw || !name) return res.status(400).json({ error: 'raw and name are required' });
    const decoded = decode(String(raw));
    if (!decoded) return res.status(400).json({ error: 'cannot decode that card value' });

    roster.upsert(decoded.uid, { name: String(name).trim() });
    roster.save();
    res.json({ uid: decoded.uid, name, size: roster.size });
  });

  // Bulk enrolment: preview first, write only on an explicit dryRun:false.
  app.post('/api/dev/roster/import', (req, res) => {
    const body = (req.body ?? {}) as { text?: unknown; mode?: unknown; dryRun?: unknown };
    if (typeof body.text !== 'string' || body.text.trim() === '') {
      return res.status(400).json({ error: 'text is required' });
    }
    const mode = body.mode === 'replace' ? 'replace' : 'merge';
    const dryRun = body.dryRun !== false;

    const parsed = parseRosterText(body.text);
    const result = mergeRoster(roster.snapshot(), parsed.rows, mode);

    if (!dryRun) {
      roster.replaceAll(result.next);
      roster.save();
    }

    res.json({
      dryRun,
      mode,
      rows: result.applied,
      errors: result.errors,
      warnings: [...parsed.warnings, ...result.warnings],
      counts: result.counts,
      // Projected size, so a dry run can honestly say what the roster would become.
      size: Object.keys(result.next).length,
    });
  });

  app.post('/api/dev/roster/remove', (req, res) => {
    const uid = String((req.body as { uid?: unknown })?.uid ?? '').toUpperCase();
    if (!roster.remove(uid)) return res.status(404).json({ error: `${uid} is not in the roster` });
    roster.save();
    res.json({ removed: uid, size: roster.size });
  });

  app.get('/api/dev/roster/export.csv', (_req, res) => {
    res
      .type('text/csv')
      .set('Content-Disposition', 'attachment; filename="employees.csv"')
      .send(rosterToCsv(roster.snapshot()));
  });
}

app.use(express.static(DIST));
// Express 5 / path-to-regexp v8 rejects `*`, so match with a regex.
app.get(/^\/dev(\/.*)?$/, (_req, res) => res.sendFile(path.join(DIST, 'index.html')));

app.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}`;
  // kiosk.bat reads this instead of hard-coding a port, so changing PORT in .env does
  // not leave the launcher pointing at a dead URL.
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(path.join(DATA, 'kiosk-url.txt'), url);
  } catch (error) {
    console.error(`could not write data/kiosk-url.txt: ${String(error)}`);
  }
  console.log(`rfid-clockin  ${url}  mode=${MODE} tz=${TZ} roster=${roster.size} taps=${taps.length}`);
});
