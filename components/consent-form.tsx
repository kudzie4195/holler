'use client';

import { useActionState, useState } from 'react';
import { Button } from './button';
import { t, type Lang } from '@/lib/i18n';
import type { ConsentState } from '@/lib/auth/stats-consent-save';

/**
 * The data-use box in Settings (round 23). Its own small form and server action, so it never touches the main profile save, exactly like
 * the language picker. The box shows the member's current answer; unticking it and saving is what the privacy page means by "untick the
 * box in Settings and we stop adding your answers from that day".
 */
export function ConsentForm({
  action,
  current,
  lang,
}: {
  action: (prev: ConsentState, formData: FormData) => Promise<ConsentState>;
  /** True when the member has consented and not revoked it. */
  current: boolean;
  lang: Lang;
}) {
  const [state, formAction, pending] = useActionState(action, {} as ConsentState);
  const [on, setOn] = useState(current);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="flex cursor-pointer items-start gap-3 text-ink">
        <input
          type="checkbox"
          name="stats_consent"
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
          aria-describedby="consent-hint"
          className="mt-0.5 h-5 w-5 shrink-0 accent-brand"
        />
        <span>{t(lang, 'consent.stats')}</span>
      </label>
      {/* The checkbox is controlled, so an unticked box sends nothing; this carries the "off" answer. */}
      <input type="hidden" name="answered" value="1" />
      <p id="consent-hint" className="text-sm text-muted">
        {t(lang, 'consent.hint')}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          {t(lang, 'consent.save')}
        </Button>
        <p role="status" className="text-sm text-muted empty:hidden">
          {state.ok ? state.message : null}
        </p>
        <p role="alert" className="text-sm font-medium text-danger empty:hidden">
          {state.error}
        </p>
      </div>
    </form>
  );
}
