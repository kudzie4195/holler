'use client';

import { useActionState } from 'react';
import { Button } from '@/components/button';
import { retireManualBidAction, type RetireState } from './actions';

/** One "Retire" button per hand-added bid: expires it now, so it leaves every member's feed, e-mail and push. Owner only (server-checked). */
export function RetireForm({ id, title }: { id: number; title: string }) {
  const [state, action, pending] = useActionState<RetireState, FormData>(retireManualBidAction, null);
  if (state?.ok) return <span className="text-sm font-medium text-success-ink">Retired</span>;
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={id} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending} aria-label={`Retire ${title}`}>
        {pending ? 'Retiring...' : 'Retire'}
      </Button>
      {state && !state.ok ? (
        <span role="alert" className="text-sm text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
