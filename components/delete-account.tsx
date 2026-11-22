'use client';

import { useActionState, useState } from 'react';
import { Button } from './button';
import { Notice } from './notice';
import { deleteAccount, type DeleteState } from '@/app/app/settings/actions';
import { t, type DictKey, type Lang } from '@/lib/i18n';

/** `lang`: the member's language (round 18 ES). English (the default) is the control as it always was. */
export function DeleteAccount({ lang = 'en' }: { lang?: Lang }) {
  const w = (key: DictKey, en: string) => (lang === 'en' ? en : t(lang, key));
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(deleteAccount, {} as DeleteState);

  if (!confirming) {
    return (
      <Button variant="secondary" onClick={() => setConfirming(true)} className="!border-danger/40 !text-danger">
        {w('del.button', 'Delete my account')}
      </Button>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4 rounded-card border border-danger/30 bg-danger-soft p-4">
      {lang === 'en' ? null : <input type="hidden" name="ui_lang" value={lang} />}
      <p className="text-ink">
        {w('del.confirm_p', "This deletes your profile, your matches and your drafts, and cancels your subscription. Your sign-in is shared with other apps we run, so it stays. It can't be undone.")}
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
          {pending ? w('del.pending', 'Deleting...') : w('del.yes', 'Yes, delete everything')}
        </Button>
        <Button variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
          {w('del.keep', 'Keep my account')}
        </Button>
      </div>
    </form>
  );
}
