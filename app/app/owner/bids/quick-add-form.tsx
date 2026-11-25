'use client';

import { useActionState } from 'react';
import { Button } from '@/components/button';
import { Input } from '@/components/input';
import { Notice } from '@/components/notice';
import { Select } from '@/components/select';
import { addManualBidAction, type QuickAddState } from './actions';

const FIELD_OF: Record<string, string> = {
  bad_url: 'url',
  contact_title: 'title',
  contact_agency: 'agency',
  contact_sol: 'solicitationId',
  too_long: 'title',
  short_link: 'url',
  terms_host: 'url',
  no_title: 'title',
  no_agency: 'agency',
  no_due: 'dueDate',
  bad_due: 'dueDate',
  closed: 'dueDate',
  due_far: 'dueDate',
  no_place: 'place',
  outside_area: 'place',
  bad_trade: 'trade',
  no_trade: 'trade',
};

export function QuickAddForm({ trades }: { trades: Array<{ id: string; label: string }> }) {
  const [state, action, pending] = useActionState<QuickAddState, FormData>(addManualBidAction, null);
  const errField = state && !state.ok && state.field ? FIELD_OF[state.field] : undefined;
  const err = (name: string) => (state && !state.ok && errField === name ? state.error : null);
  const today = new Date().toISOString().slice(0, 10);
  // After a refusal or a preview the form is remounted (key) with what was typed, so nothing has to be entered again.
  const v = (state && (!state.ok || state.step === 'preview') ? state.values : undefined) ?? {};
  const preview = state && state.ok && state.step === 'preview' ? state : null;
  const done = state && state.ok && state.step === 'done' ? state : null;
  return (
    <form key={state?.n ?? 0} action={action} className="mt-8 flex flex-col gap-5" noValidate>
      <Input label="Link to the bid (https only)" name="url" defaultValue={v.url} type="url" inputMode="url" required placeholder="https://mariettaga.gov/Bids.aspx?bidID=123" error={err('url')} hint="The bid's own page if it has one; the agency's list page otherwise (then add the solicitation number)." />
      <Input label="Title" name="title" defaultValue={v.title} required maxLength={300} error={err('title')} />
      <Input label="Agency" name="agency" defaultValue={v.agency} required maxLength={200} placeholder="City of Marietta" error={err('agency')} />
      <Input label="Solicitation number (optional)" name="solicitationId" defaultValue={v.solicitationId} maxLength={80} placeholder="RFP 26-014" error={err('solicitationId')} hint="Used to catch the same bid added twice." />
      <Input label="Due date" name="dueDate" defaultValue={v.dueDate} type="date" required min={today} error={err('dueDate')} hint="A date in the past is refused. A date alone closes at 11:59 PM in the agency's state." />
      <Input label="Place: ZIP or City, ST" name="place" defaultValue={v.place} required maxLength={80} placeholder="30060 or Marietta, GA" error={err('place')} hint="Placed at the ZIP or city centre (block level), never a street address." />
      <Select label="Trade (optional)" name="trade" defaultValue={v.trade ?? ''} error={err('trade')} hint="Leave on automatic to let the title decide, as for every bid.">
        <option value="">Automatic (from the title)</option>
        {trades.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </Select>
      {state && !state.ok && !errField ? (
        <Notice tone="danger" role="alert">
          {state.error}
        </Notice>
      ) : null}
      {preview ? (
        <div className="rounded-card border border-line bg-surface p-4 text-sm text-ink" aria-live="polite" data-testid="quick-preview">
          <p className="font-semibold">Check before publishing. Nothing has been saved yet. Members will see:</p>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted">Title</dt>
            <dd>{preview.preview.storedTitle}</dd>
            <dt className="text-muted">Agency</dt>
            <dd>{preview.preview.agency}</dd>
            <dt className="text-muted">Number</dt>
            <dd>{preview.preview.solicitationId ?? 'none'}</dd>
            <dt className="text-muted">Due</dt>
            <dd>{preview.preview.dueDate}</dd>
            <dt className="text-muted">Place</dt>
            <dd>{preview.preview.place}</dd>
            <dt className="text-muted">Trades</dt>
            <dd>{preview.preview.trades.join(', ')}</dd>
            <dt className="text-muted">Link host</dt>
            <dd className="font-mono">{preview.preview.host}</dd>
            <dt className="text-muted">Link</dt>
            <dd className="break-all font-mono text-xs">{preview.preview.url}</dd>
          </dl>
          {preview.preview.notes.length ? (
            <ul className="mt-2 list-disc pl-5 font-medium text-warn-ink">
              {preview.preview.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          <input type="hidden" name="confirmKey" value={preview.confirmKey} />
          {!preview.bidsOn ? <p className="mt-2 font-medium text-warn-ink">HOLLER_BIDS_ENABLED is off: publishing will be refused.</p> : null}
          <p className="mt-2 text-muted">Changed a field? Press Preview again: a changed bid cannot be published from the old preview.</p>
        </div>
      ) : null}
      {done ? (
        <Notice tone="success" role="status">
          Added &ldquo;{done.title}&rdquo; from {done.agency} ({done.trades.join(', ')}), linking to {done.host}. Matched to {done.matched} member
          {done.matched === 1 ? '' : 's'}. Added by mistake? Retire it in the list below.
          {done.note ? ` ${done.note}` : ''}
        </Notice>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="intent" value="preview" variant={preview ? 'secondary' : 'primary'} disabled={pending}>
          {pending ? 'Checking...' : 'Preview'}
        </Button>
        {preview ? (
          <Button type="submit" name="intent" value="publish" disabled={pending}>
            Publish this bid
          </Button>
        ) : null}
      </div>
    </form>
  );
}
