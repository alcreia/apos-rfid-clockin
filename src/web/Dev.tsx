import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RosterImport from './RosterImport.js';
import { api, postJson } from './api.js';
import { judge, measure, pushKey, type Burst, type Keystroke } from './burst.js';

type Decoded = { cleaned: string; asDecimal: string | null; asHex: string | null };
type Employee = { uid: string; name: string };
type Rejected = { at: string; raw: string; reason: string; decoded?: Decoded };

/** Mirror of src/core/uid.ts, so the page can show what a tap will decode to. */
function fromReaderDecimal(value: string): string | null {
  if (!/^\d{1,10}$/.test(value)) return null;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n > 0xffffffff) return null;
  const padded = n.toString(16).toUpperCase().padStart(8, '0');
  return (padded.match(/../g) ?? []).reverse().join('');
}

function encodeToReaderDecimal(uid: string): string | null {
  if (!/^[0-9A-F]{8}$/i.test(uid)) return null;
  const bytes = uid.toUpperCase().match(/../g) ?? [];
  return String(parseInt(bytes.reverse().join(''), 16));
}

export default function Dev() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [decoded, setDecoded] = useState<Decoded | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [name, setName] = useState('');
  const [notice, setNotice] = useState('');
  const [manualUid, setManualUid] = useState('');
  const [lastRaw, setLastRaw] = useState('');
  const [log, setLog] = useState<
    Array<{
      raw: string;
      uid: string | null;
      at: string;
      durationMs: number;
      maxGapMs: number;
      verdict: string | null;
    }>
  >([]);
  const keys = useRef<Keystroke[]>([]);

  const refresh = useCallback(async () => {
    const [roster, rejected] = await Promise.all([
      api<{ employees?: Employee[] }>('/api/dev/roster'),
      api<{ entries?: Rejected[] }>('/api/dev/rejected'),
    ]);
    if (roster.body?.employees) setEmployees(roster.body.employees);
    setRejected(rejected.body?.entries ?? []);
  }, []);

  useEffect(() => {
    void refresh();
    inputRef.current?.focus();
  }, [refresh]);

  // A kiosk has no keyboard and a test session has a mouse: re-focus the reader box
  // whenever nothing else holds focus, but never steal focus from a field being typed in.
  useEffect(() => {
    const id = window.setInterval(() => {
      const active = document.activeElement;
      if (!active || active === document.body) inputRef.current?.focus({ preventScroll: true });
    }, 1500);
    return () => window.clearInterval(id);
  }, []);

  // Built once per roster change: the burst log looks a name up for every row.
  const nameByUid = useMemo(() => new Map(employees.map((e) => [e.uid, e.name])), [employees]);
  const nameFor = (uid: string | null) => (uid ? (nameByUid.get(uid) ?? null) : null);

  /**
   * A reader burst ends with Enter. Commit it, then empty the box — otherwise the
   * next card's digits are appended to this one and the decode is nonsense.
   */
  const commitBurst = (raw: string, burst?: Burst) => {
    if (!raw.trim()) return;
    const cleaned = raw.replace(/[\s:.-]/g, '').toUpperCase();
    const asDecimal = fromReaderDecimal(cleaned);
    const asHex = /^[0-9A-F]{8}$/.test(cleaned) ? cleaned : null;
    setDecoded({ cleaned, asDecimal, asHex });
    setLastRaw(raw.trim());
    setValue('');
    setLog((prev) =>
      [
        {
          raw: raw.trim(),
          uid: asDecimal ?? asHex,
          at: new Date().toISOString(),
          durationMs: burst?.durationMs ?? 0,
          maxGapMs: burst?.maxGapMs ?? 0,
          verdict: burst ? judge(burst) : null,
        },
        ...prev,
      ].slice(0, 60),
    );
  };

  const enrol = async () => {
    if (!lastRaw || !name) return;
    const { body, networkError } = await postJson<{ uid?: string; name?: string; error?: string }>(
      '/api/dev/enroll',
      { raw: lastRaw, name },
    );
    setNotice(
      networkError
        ? 'server unreachable'
        : body?.error
          ? `error: ${body.error}`
          : `enrolled ${body?.uid} as ${body?.name}`,
    );
    setName('');
    setDecoded(null);
    setLastRaw('');
    await refresh();
  };

  const remove = async (uid: string) => {
    await fetch('/api/dev/roster/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid }),
    });
    setNotice(`removed ${uid}`);
    await refresh();
  };

  const simulate = async () => {
    const dec = /^\d+$/.test(manualUid) ? manualUid : encodeToReaderDecimal(manualUid);
    if (!dec) return setNotice('need a UID (8 hex) or a decimal value');
    const { status, body, networkError } = await postJson('/api/tap', { raw: dec });
    setNotice(networkError ? 'server unreachable' : `POST /api/tap ${dec} -> ${status} ${JSON.stringify(body)}`);
    await refresh();
  };

  return (
    <div className="dev">
      <h1>rfid-clockin · /dev</h1>
      <p className="dev__lead">
        Everything here is disabled when <code>DEV=0</code>. The reader types into the focused box.
      </p>

      <section className="panel">
        <h2>Reader output</h2>
        <input
          ref={inputRef}
          className="dev__input"
          placeholder="tap a card here"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            const at = performance.now();
            if (e.key !== 'Enter') {
              if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
                keys.current = pushKey(keys.current, at, e.key);
              }
              return;
            }
            e.preventDefault();
            const raw = e.currentTarget.value;
            // The dev page accepts anything, including typing — that is the point of it —
            // but it shows the burst timing so the kiosk's threshold can be checked.
            const burst = measure(keys.current, at);
            keys.current = [];
            // Clear the DOM node synchronously as well as the state: state updates are
            // async, and a second burst landing in the same tick would otherwise append
            // its digits to this one and decode as nonsense.
            e.currentTarget.value = '';
            commitBurst(raw, burst);
          }}
        />
        {decoded && (
          <table className="dev__table">
            <tbody>
              <tr>
                <th>raw</th>
                <td>
                  <code>{decoded.cleaned || '—'}</code>
                </td>
              </tr>
              <tr>
                <th>read as decimal (reversed bytes)</th>
                <td>
                  <code>{decoded.asDecimal ?? 'not decodable'}</code>
                </td>
              </tr>
              <tr>
                <th>already hex</th>
                <td>
                  <code>{decoded.asHex ?? '—'}</code>
                </td>
              </tr>
              <tr>
                <th>name in roster</th>
                <td>
                  {nameFor(decoded.asDecimal ?? decoded.asHex) ?? (
                    <span className="chip chip--err">not in roster</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        )}
        <div className="row">
          <input
            className="dev__input"
            placeholder="name for this card"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button onClick={enrol} disabled={!lastRaw || !name}>
            Enrol card
          </button>
        </div>
        {notice && <p className="dev__notice">{notice}</p>}
      </section>

      <section className="panel">
        <h2>
          Reader test log ({log.length}){' '}
          {log.length > 0 && (
            <button className="ghost" onClick={() => setLog([])}>
              clear
            </button>
          )}
        </h2>
        <p className="dev__lead">
          {(() => {
            const seen = new Set(log.map((e) => e.uid).filter((u): u is string => Boolean(u)));
            const matched = employees.filter((e) => seen.has(e.uid)).length;
            const unknown = [...seen].filter((u) => !employees.some((e) => e.uid === u)).length;
            return `${matched} of ${employees.length} roster cards seen · ${seen.size} distinct UIDs${unknown > 0 ? ` · ${unknown} UID(s) not in roster` : ''}`;
          })()}
        </p>
        <p className="dev__lead">
          The kiosk only accepts a burst whose card-like rhythm it trusts: characters within 40 ms of
          each other, done in under 400 ms. The timing column is the measurement — if a real tap reads
          slower than that, the threshold is wrong for this reader, not the reader.
        </p>
        <table className="dev__table">
          <thead>
            <tr>
              <th>time</th>
              <th>raw burst</th>
              <th>UID</th>
              <th>name in roster</th>
              <th>timing</th>
            </tr>
          </thead>
          <tbody>
            {log.map((e, i) => (
              <tr key={i}>
                <td>{new Date(e.at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta' })}</td>
                <td>
                  <code>{e.raw}</code>
                </td>
                <td>
                  <code>{e.uid ?? '—'}</code>
                </td>
                <td>{e.uid ? (nameFor(e.uid) ?? <span className="chip chip--err">not in roster</span>) : 'undecodable'}</td>
                <td>
                  {e.durationMs} ms · gap {e.maxGapMs} ms{' '}
                  {e.verdict ? (
                    <span className="chip chip--err">{e.verdict}</span>
                  ) : (
                    <span className="chip chip--ok">kiosk would accept</span>
                  )}
                </td>
              </tr>
            ))}
            {log.length === 0 && (
              <tr>
                <td colSpan={5}>tap a card above — each burst is recorded here so 42 cards can be checked</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Simulate a tap (no hardware)</h2>
        <div className="row">
          <input
            className="dev__input"
            placeholder="8B17E350, or a decimal like 1357059979"
            value={manualUid}
            onChange={(e) => setManualUid(e.target.value)}
          />
          <button onClick={simulate}>POST /api/tap</button>
        </div>
      </section>

      <RosterImport onApplied={refresh} />

      <section className="panel">
        <h2>
          Roster ({employees.length}){' '}
          <a className="link" href="/api/dev/roster/export.csv">
            export CSV
          </a>
        </h2>
        <table className="dev__table">
          <thead>
            <tr>
              <th>UID</th>
              <th>name</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.uid}>
                <td>
                  <code>{e.uid}</code>
                </td>
                <td>{e.name}</td>
                <td>
                  <button className="ghost" onClick={() => void remove(e.uid)}>
                    remove
                  </button>
                </td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr>
                <td colSpan={3}>empty — tap a card above and give it a name, or paste a list</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Rejected taps ({rejected.length})</h2>
        <p className="dev__lead">
          Unidentified cards are never written to the Log. If someone's first morning produces one of
          these, enrol the card and their row is one tap away.
        </p>
        <table className="dev__table">
          <thead>
            <tr>
              <th>when</th>
              <th>raw</th>
              <th>reason</th>
              <th>assign a name</th>
            </tr>
          </thead>
          <tbody>
            {rejected.map((r, i) => (
              <tr key={i}>
                <td>{new Date(r.at).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' })}</td>
                <td>
                  <code>{r.raw || '—'}</code>
                </td>
                <td>{r.reason}</td>
                <td>
                  <AssignCard entry={r} onDone={refresh} />
                </td>
              </tr>
            ))}
            {rejected.length === 0 && (
              <tr>
                <td colSpan={4}>none</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/** One-line enrolment straight from a rejected tap: the card is already in hand. */
function AssignCard({ entry, onDone }: { entry: Rejected; onDone: () => void }) {
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const uid = entry.decoded?.asDecimal ?? null;

  if (!uid) return <span className="dev__lead">not a card read</span>;

  const submit = async () => {
    const { body, networkError } = await postJson<{ uid?: string; error?: string }>('/api/dev/enroll', {
      raw: entry.raw,
      name,
    });
    setMsg(networkError ? 'server unreachable' : (body?.error ?? body?.uid ?? ''));
    setName('');
    onDone();
  };

  return (
    <div className="assign">
      <code className="dim">{uid}</code>
      <input
        className="dev__input"
        placeholder="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name) void submit();
        }}
      />
      <button disabled={!name} onClick={() => void submit()}>
        assign
      </button>
      {msg && <span className="dev__lead">{msg}</span>}
    </div>
  );
}
