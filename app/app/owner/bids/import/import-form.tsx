'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/button';
import { Notice } from '@/components/notice';
import { Select } from '@/components/select';
import { SERVICE_ERROR_TEXT, type CsvAnalysis } from '@/lib/signals/manual-bids/service-text';
import { csvAction, type CsvState } from '../actions';

const MAX_CHARS = 900_000;

function Summary({ a }: { a: CsvAnalysis }) {
  const reasons = Object.entries(a.skipped);
  return (
    <div className="text-sm text-ink">
      <p>
        <strong>{a.add}</strong> to add, <strong>{a.skip}</strong> skipped.
      </p>
      {reasons.length ? (
        <ul className="mt-1 list-disc pl-5">
          {reasons.map(([r, n]) => (
            <li key={r}>
              {r}: {n}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Rows({ a }: { a: CsvAnalysis }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">Rows in the file and what happens to each</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="py-2 pr-3">Line</th>
            <th scope="col" className="py-2 pr-3">Result</th>
            <th scope="col" className="py-2 pr-3">Title</th>
            <th scope="col" className="py-2 pr-3">Agency</th>
            <th scope="col" className="py-2 pr-3">Due</th>
            <th scope="col" className="py-2 pr-3">Place</th>
            <th scope="col" className="py-2 pr-3">Trades</th>
            <th scope="col" className="py-2 pr-3">Link host</th>
          </tr>
        </thead>
        <tbody>
          {a.rows.map((r) => (
            <tr key={r.line} className="border-b border-line align-top">
              <td className="py-2 pr-3 font-mono">{r.line}</td>
              <td className={`py-2 pr-3 ${r.action === 'add' ? 'font-semibold text-success-ink' : 'text-muted'}`}>{r.action === 'add' ? 'Add' : `Skip: ${r.reason ?? ''}`}</td>
              <td className="py-2 pr-3">{r.title}</td>
              <td className="py-2 pr-3">{r.agency}</td>
              <td className="py-2 pr-3 whitespace-nowrap">{r.dueDate}</td>
              <td className="py-2 pr-3">{r.place}</td>
              <td className="py-2 pr-3">{r.trades.join(', ')}</td>
              <td className="py-2 pr-3 font-mono">{r.host}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function errorText(r: { error: keyof typeof SERVICE_ERROR_TEXT; missing?: string[] }): string {
  const base = SERVICE_ERROR_TEXT[r.error] ?? 'Something went wrong.';
  return r.missing?.length ? `${base} Missing: ${r.missing.join(', ')}.` : base;
}

export function ImportForm({ formats }: { formats: Array<{ id: string; label: string; confirmed: boolean }> }) {
  const [state, action, pending] = useActionState<CsvState, FormData>(csvAction, null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [format, setFormat] = useState(formats[0]?.id ?? 'generic');
  const [readError, setReadError] = useState<string | null>(null);
  // The confirm button is offered only for a preview of exactly this text and format (the server checks everything again anyway).
  const [previewedFor, setPreviewedFor] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setReadError(null);
    setPreviewedFor(null);
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    if (f.size > MAX_CHARS) {
      setText('');
      setReadError(SERVICE_ERROR_TEXT.too_big);
      return;
    }
    try {
      setText(await f.text());
    } catch {
      setText('');
      setReadError('That file could not be read.');
    }
  }

  const key = `${format}\u0000${text}`;
  const preview = state?.step === 'preview' ? state.result : null;
  const done = state?.step === 'import' ? state.result : null;
  const canConfirm = !!preview && preview.ok && preview.bidsOn && preview.analysis.add > 0 && previewedFor === key;

  return (
    <form action={action} className="mt-8 flex flex-col gap-5" onSubmit={() => setPreviewedFor(key)}>
      <Select label="File format" name="format" value={format} onChange={(e) => { setFormat(e.target.value); setPreviewedFor(null); }}>
        {formats.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </Select>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="csv-file" className="text-sm font-semibold text-ink">
          CSV file
        </label>
        <input id="csv-file" type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm" />
        {fileName ? <p className="text-sm text-muted">{fileName}</p> : null}
      </div>
      <input type="hidden" name="csv" value={text} />
      {readError ? (
        <Notice tone="danger" role="alert">
          {readError}
        </Notice>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="intent" value="preview" variant="secondary" disabled={pending || !text}>
          {pending ? 'Working...' : 'Preview'}
        </Button>
        <Button type="submit" name="intent" value="import" disabled={pending || !canConfirm}>
          {preview && preview.ok ? `Add ${preview.analysis.add} bid${preview.analysis.add === 1 ? '' : 's'}` : 'Add bids'}
        </Button>
      </div>
      {preview && !preview.ok ? (
        <Notice tone="danger" role="alert">
          {errorText(preview)}
        </Notice>
      ) : null}
      {preview && preview.ok ? (
        <div aria-live="polite">
          <Notice tone="info" role="status">
            Preview only: nothing has been saved.
            <Summary a={preview.analysis} />
          </Notice>
          <Rows a={preview.analysis} />
        </div>
      ) : null}
      {done && !done.ok ? (
        <Notice tone="danger" role="alert">
          {errorText(done)}
        </Notice>
      ) : null}
      {done && done.ok ? (
        <div aria-live="polite">
          <Notice tone="success" role="status">
            Added {done.inserted} bid{done.inserted === 1 ? '' : 's'}, matched to members {done.matched} time{done.matched === 1 ? '' : 's'}.
            {done.note ? ` ${done.note}` : ''}
            <Summary a={done.analysis} />
          </Notice>
          <Rows a={done.analysis} />
        </div>
      ) : null}
    </form>
  );
}
