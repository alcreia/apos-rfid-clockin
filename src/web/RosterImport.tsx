import { useState } from 'react';
import { postJson } from './api.js';

type AppliedRow = {
  line: number;
  input: string;
  uid: string | null;
  name: string;
  status: 'added' | 'updated' | 'unchanged' | 'error';
  error?: string;
};

type ImportResponse = {
  dryRun: boolean;
  mode: string;
  rows: AppliedRow[];
  errors: { line: number; message: string }[];
  warnings: string[];
  counts: { added: number; updated: number; unchanged: number; removed: number; errors: number };
  size?: number;
};

const SAMPLE = `# uid,name — UIDs may be 8-hex or the reader's decimal
8B17E350,Ayu
A401E15B,"Sari Dewi"`;

export default function RosterImport({ onApplied }: { onApplied: () => void }) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [preview, setPreview] = useState<ImportResponse | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async (dryRun: boolean) => {
    setBusy(true);
    setNotice('');
    try {
      const { body, networkError } = await postJson<ImportResponse & { error?: string }>(
        '/api/dev/roster/import',
        { text, mode, dryRun },
      );
      if (networkError) {
        setNotice('server unreachable');
        return;
      }
      if (!body) {
        setNotice('the server returned something that was not JSON');
        return;
      }
      if (body.error) {
        setNotice(body.error);
        return;
      }
      setPreview(body);
      if (!dryRun) {
        const c = body.counts;
        setNotice(
          `applied — ${c.added} added, ${c.updated} updated, ${c.removed} removed, ${c.errors} skipped`,
        );
        onApplied();
      }
    } finally {
      setBusy(false);
    }
  };

  const c = preview?.counts;
  const changed = c ? c.added + c.updated + c.removed : 0;

  return (
    <section className="panel">
      <h2>Bulk enrolment</h2>
      <p className="dev__lead">
        One row per card. Delimiter can be a tab (paste from Sheets), a comma, or a semicolon.
        The first column may be the 8-hex UID <em>or</em> the reader's decimal — useful before the
        reader is plugged in. A header row is detected and skipped. Preview first; nothing is
        written until you press Apply.
      </p>

      <textarea
        className="dev__input dev__textarea"
        placeholder={SAMPLE}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
        spellCheck={false}
      />

      <div className="row">
        <select className="dev__input dev__select" value={mode} onChange={(e) => setMode(e.target.value as 'merge' | 'replace')}>
          <option value="merge">merge — add and update, keep the rest</option>
          <option value="replace">replace — the paste becomes the whole roster</option>
        </select>
        <button onClick={() => void send(true)} disabled={busy || !text.trim()}>
          Preview
        </button>
        <button
          className="primary"
          onClick={() => void send(false)}
          disabled={busy || !preview || changed === 0}
        >
          Apply
        </button>
        <button className="ghost" onClick={() => setText(SAMPLE)} disabled={busy}>
          sample
        </button>
      </div>

      {notice && <p className="dev__notice">{notice}</p>}

      {preview && (
        <>
          <div className="chips">
            <span className="chip chip--add">+{preview.counts.added} added</span>
            <span className="chip chip--upd">~{preview.counts.updated} updated</span>
            <span className="chip">={preview.counts.unchanged} unchanged</span>
            {preview.counts.removed > 0 && (
              <span className="chip chip--del">−{preview.counts.removed} removed</span>
            )}
            {preview.counts.errors > 0 && (
              <span className="chip chip--err">!{preview.counts.errors} skipped</span>
            )}
            {preview.size !== undefined && <span className="chip">roster → {preview.size}</span>}
          </div>

          <table className="dev__table">
            <thead>
              <tr>
                <th>line</th>
                <th>as typed</th>
                <th>UID</th>
                <th>name</th>
                <th>status</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={row.line} className={row.status === 'error' ? 'row--err' : undefined}>
                  <td>{row.line}</td>
                  <td>
                    <code className="dim">{row.input || '—'}</code>
                  </td>
                  <td>
                    <code>{row.uid ?? '—'}</code>
                  </td>
                  <td>{row.name || '—'}</td>
                  <td>
                    {row.status === 'error' ? (
                      <span className="chip chip--err">{row.error}</span>
                    ) : (
                      <span className={`chip chip--${row.status === 'added' ? 'add' : row.status === 'updated' ? 'upd' : 'same'}`}>
                        {row.status}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {preview.warnings.length > 0 && (
            <ul className="dev__lead">
              {preview.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
