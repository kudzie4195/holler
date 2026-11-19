'use client';

import { useActionState, useState } from 'react';
import { Button } from './button';
import { Notice } from './notice';
import { deleteAccount, type DeleteState } from '@/app/app/settings/actions';

export function DeleteAccount() {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(deleteAccount, {} as DeleteState);

  if (!confirming) {
    return (
      <Button variant="secondary" onClick={() => setConfirming(true)} className="!border-danger/40 !text-danger">
        Delete my account
      </Button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4 rounded-xl border border-danger/30 bg-danger-soft p-4">
      <p className="text-ink">
        This deletes your profile, your matches and your drafts, and cancels your subscription. Your sign-in is shared with other apps we run, so it stays. It can&apos;t be undone.
      </p>
      {state.error ? (
        <Notice tone="danger" role="alert">
          {state.error}
        </Notice>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          disabled={pending}
          className="!bg-danger !text-surface hover:!bg-danger/90"
        >
          {pending ? 'Deleting...' : 'Yes, delete everything'}
        </Button>
        <Button variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
          Keep my account
        </Button>
      </div>
    </form>
  );
}
