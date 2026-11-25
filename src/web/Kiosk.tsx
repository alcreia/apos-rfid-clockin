import { useEffect, useRef, useState } from 'react';
import { api, postJson } from './api.js';
import { judge, measure, pushKey, type Keystroke, type Rejection } from './burst.js';

type Outcome =
  | { kind: 'idle' }
  | { kind: 'ok'; name: string; time: string }
  | { kind: 'duplicate'; name: string; time: string | null }
  | { kind: 'unknown' }
  // The server did not answer, or answered with a 5xx. Distinct from 'unknown': the
  // card may be perfectly enrolled and the employee would be told the wrong thing.
  | { kind: 'error' };

const RESULT_MS = 3000;

/**
 * Formatters are built once. `toLocaleTimeString(…, { timeZone })` constructs a new
 * Intl.DateTimeFormat on every call, which measured 78x slower than reusing one — and
 * this used to run on every one-second tick.
 */
const CLOCK_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jakarta',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const DATE_FMT = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Owns the per-second tick, so the result card is not re-rendered 60 times a minute. */
function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <header className="kiosk__head">
      <div className="kiosk__clock">{CLOCK_FMT.format(now)}</div>
      <div className="kiosk__date">{DATE_FMT.format(now)}</div>
    </header>
  );
}

type CardProps = { icon: string; title: string; sub?: string; modifier?: string; iconClass?: string };

function Card({ icon, title, sub, modifier, iconClass }: CardProps) {
  return (
    <div className={modifier ? `card ${modifier}` : 'card'}>
      <div className={iconClass ? `card__icon ${iconClass}` : 'card__icon'} aria-hidden="true">
        {icon}
      </div>
      <div className="card__title">{title}</div>
      {sub ? <div className="card__sub">{sub}</div> : null}
    </div>
  );
}

/** One component per outcome — no && chains, and adding a state is a compile error. */
function OutcomeCard({ outcome }: { outcome: Outcome }) {
  switch (outcome.kind) {
    case 'idle':
      return <Card icon="◉" iconClass="card__icon--tap" title="Tempelkan kartu Anda" />;
    case 'ok':
      return <Card modifier="card--ok" icon="✓" title={outcome.name} sub={`Tap absen di jam ${outcome.time}`} />;
    case 'duplicate':
      return (
        <Card
          modifier="card--dup"
          icon="↺"
          title={outcome.name}
          sub={`Sudah tap${outcome.time ? ` di jam ${outcome.time}` : ''}`}
        />
      );
    case 'unknown':
      return <Card modifier="card--err" icon="✕" title="Kartu tidak dikenal" />;
    case 'error':
      return <Card modifier="card--warn" icon="!" title="Gagal menyimpan" sub="Silakan tap ulang" />;
  }

  const exhaustive: never = outcome;
  return exhaustive;
}

type TapResponse = { status?: string; name?: string; time?: string };

export default function Kiosk() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const [unsaved, setUnsaved] = useState(0);
  const [mode, setMode] = useState('stub');
  const timer = useRef<number | null>(null);
  const keys = useRef<Keystroke[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef<number | null>(null);

  /**
   * Keyboard input is ignored rather than misread as a card — and it says so, because a
   * kiosk that silently does nothing looks broken to the person standing at it.
   */
  const showHint = (reason: Rejection) => {
    setHint(
      reason === 'too-slow' || reason === 'key-repeat'
        ? 'Tempelkan kartu, bukan mengetik'
        : 'Gunakan kartu Anda',
    );
    if (hintTimer.current) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 2500);
  };

  useEffect(() => {
    const poll = async () => {
      const { body } = await api<{ pending: number; unsynced: number; mode: string }>('/api/state');
      if (!body) return;
      // Queue length alone reads zero once retries are exhausted, which would show
      // "saved" for a tap that never reached the sheet.
      setUnsaved(body.pending + body.unsynced);
      setMode(body.mode);
    };
    void poll();
    const id = window.setInterval(() => void poll(), 5000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => inputRef.current?.focus({ preventScroll: true }), 1500);
    return () => window.clearInterval(id);
  }, []);

  const submit = async (raw: string) => {
    if (raw.trim().length < 2) return;

    const { status, body, networkError } = await postJson<TapResponse>('/api/tap', { raw });

    if (body?.status === 'recorded') setOutcome({ kind: 'ok', name: body.name ?? '', time: body.time ?? '' });
    else if (body?.status === 'duplicate') setOutcome({ kind: 'duplicate', name: body.name ?? '', time: body.time ?? null });
    else if (networkError || status >= 500) setOutcome({ kind: 'error' });
    else setOutcome({ kind: 'unknown' });

    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOutcome({ kind: 'idle' }), RESULT_MS);
  };

  return (
    <div className={`kiosk kiosk--${outcome.kind}`} onMouseDown={() => inputRef.current?.focus({ preventScroll: true })}>
      <input
        ref={inputRef}
        className="wedge"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          const at = performance.now();

          if (e.key !== 'Enter') {
            // No modifiers: a reader sends bare digits, and Shift would turn one into a
            // symbol. Ctrl/Alt/Meta also mean a shortcut, not a card.
            if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
              keys.current = pushKey(keys.current, at, e.key);
              if (keys.current.length > 64) keys.current = keys.current.slice(-64);
            }
            return;
          }

          e.preventDefault();
          const raw = e.currentTarget.value;
          const burst = measure(keys.current, at);
          keys.current = [];

          // Clear the node synchronously too: a state update is async, and a second
          // burst in the same tick would append its digits to this one.
          e.currentTarget.value = '';
          setValue('');

          // Typed input never reaches the server: no ledger row, no rejected-card log,
          // no sheet write. Only the card reader's rhythm gets through.
          const rejection = judge(burst);
          if (rejection) {
            showHint(rejection);
            return;
          }
          void submit(raw);
        }}
        aria-label="card reader input"
      />

      <Clock />

      <main className="kiosk__stage" role="status" aria-live="polite">
        <OutcomeCard outcome={outcome} />
        {hint ? <div className="card__hint">{hint}</div> : null}
      </main>

      <footer className="kiosk__foot">
        <span className={`badge ${unsaved > 0 ? 'badge--warn' : 'badge--ok'}`}>
          {unsaved > 0 ? `${unsaved} belum masuk` : 'Tersimpan'}
        </span>
        {mode === 'stub' && <span className="badge badge--stub">stub mode — not writing to Google</span>}
      </footer>
    </div>
  );
}
