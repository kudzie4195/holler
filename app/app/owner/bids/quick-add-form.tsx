'use client';

import { useActionState } from 'react';
import { Button } from '@/components/button';
import { Input } from '@/components/input';
import { Notice } from '@/components/notice';
import { Select } from '@/components/select';
import { addManualBidAction, type QuickAddState } from './actions';

const FIELD_OF: Record<string, string> = {
  bad_url: 'url',
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
  // After a refusal the form is remounted (key) with what was typed, so nothing has to be entered again.
  const v = (state && !state.ok ? state.values : undefined) ?? {};
  return (
    <form key={state?.n ?? 0} action={action} className="mt-8 flex flex-col gap-5" noValidate>
      <Input label="Link to the bid (https only)" name="url" defaultValue={v.url} type="url" inputMode="url" required placeholder="https://mariettaga.gov/Bids.aspx?bidID=123" error={err('url')} hint="The bid's own page if it has one; the agency's list page otherwise (then add the solicitation number)." />
      <Input label="Title" name="title" defaultValue={v.title} required maxLength={300} error={err('title')} />
      <Input label="Agency" name="agency" defaultValue={v.agency} required maxLength={200} placeholder="City of Marietta" error={err('agency')} />
      <Input label="Solicitation number (optional)" name="solicitationId" defaultValue={v.solicitationId} maxLength={80} placeholder="RFP 26-014" hint="Used to catch the same bid added twice." />
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
      {state && state.ok ? (
        <Notice tone="success" role="status">
          Added &ldquo;{state.title}&rdquo; ({state.trades.join(', ')}), linking to {state.host}. Matched to {state.matched} member{state.matched === 1 ? '' : 's'}.
          {state.note ? ` ${state.note}` : ''}
        </Notice>
      ) : null}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding...' : 'Add bid'}
        </Button>
      </div>
    </form>
  );
}
