import { useEffect, useRef, useState } from 'react';

type Outcome =
  | { kind: 'idle' }
  | { kind: 'ok'; name: string; time: string }
  | { kind: 'duplicate'; name: string; time: string | null }
  | { kind: 'unknown' }
  // The server did not answer, or answered with a 5xx. Distinct from 'unknown': the
  // card may be perfectly enrolled and the employee is being told the wrong thing.
  | { kind: 'error' };

const RESULT_MS = 3000;

export default function Kiosk() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const [now, setNow] = useState(new Date());
  const [pending, setPending] = useState(0);
  const [mode, setMode] = useState('stub');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const poll = () =>
      fetch('/api/state')
        .then((r) => r.json())
        .then((s: { pending: number; unsynced: number; mode: string }) => {
          // Queue length alone reads zero after the retries are exhausted, which would
          // show "saved" for a tap that never reached the sheet.
          setPending(s.pending + s.unsynced);
          setMode(s.mode);
        })
        .catch(() => {});
    poll();
    const id = window.setInterval(poll, 5000);
    return () => window.clearInterval(id);
  }, []);

  const focus = () => inputRef.current?.focus({ preventScroll: true });
  useEffect(() => {
    focus();
    const id = window.setInterval(focus, 1500);
    return () => window.clearInterval(id);
  }, []);

  const submit = async (raw: string) => {
    if (raw.trim().length < 2) return;
    const res = await fetch('/api/tap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    }).catch(() => null);

    const body = res ? await res.json().catch(() => null) : null;
    if (body?.status === 'recorded') setOutcome({ kind: 'ok', name: body.name, time: body.time });
    else if (body?.status === 'duplicate') setOutcome({ kind: 'duplicate', name: body.name, time: body.time });
    else if (!res || res.status >= 500) setOutcome({ kind: 'error' });
    else setOutcome({ kind: 'unknown' });

    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOutcome({ kind: 'idle' }), RESULT_MS);
  };

  const clock = now.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const date = now.toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className={`kiosk kiosk--${outcome.kind}`} onMouseDown={focus}>
      <input
        ref={inputRef}
        className="wedge"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const raw = e.currentTarget.value;
            // Clear the node synchronously too: a state update is async, and a second
            // burst in the same tick would append its digits to this one.
            e.currentTarget.value = '';
            setValue('');
            void submit(raw);
          }
        }}
        aria-label="card reader input"
      />

      <header className="kiosk__head">
        <div className="kiosk__clock">{clock}</div>
        <div className="kiosk__date">{date}</div>
      </header>

      <main className="kiosk__stage">
        {outcome.kind === 'idle' && (
          <div className="card">
            <div className="card__icon card__icon--tap">◉</div>
            <div className="card__title">Tempelkan kartu Anda</div>
          </div>
        )}

        {outcome.kind === 'ok' && (
          <div className="card card--ok">
            <div className="card__icon">✓</div>
            <div className="card__title">{outcome.name}</div>
            <div className="card__sub">Tap absen di jam {outcome.time}</div>
          </div>
        )}

        {outcome.kind === 'duplicate' && (
          <div className="card card--dup">
            <div className="card__icon">↺</div>
            <div className="card__title">{outcome.name}</div>
            <div className="card__sub">
              Sudah tap{outcome.time ? ` di jam ${outcome.time}` : ''}
            </div>
          </div>
        )}

        {outcome.kind === 'unknown' && (
          <div className="card card--err">
            <div className="card__icon">✕</div>
            <div className="card__title">Kartu tidak dikenal</div>
          </div>
        )}

        {outcome.kind === 'error' && (
          <div className="card card--warn">
            <div className="card__icon">!</div>
            <div className="card__title">Gagal menyimpan</div>
            <div className="card__sub">Silakan tap ulang</div>
          </div>
        )}
      </main>

      <footer className="kiosk__foot">
        <span className={`badge ${pending > 0 ? 'badge--warn' : 'badge--ok'}`}>
          {pending > 0 ? `${pending} belum masuk` : 'Tersimpan'}
        </span>
        {mode === 'stub' && <span className="badge badge--stub">stub mode — not writing to Google</span>}
      </footer>
    </div>
  );
}
