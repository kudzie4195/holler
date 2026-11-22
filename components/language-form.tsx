'use client';

import { useActionState } from 'react';
import { Button } from './button';
import { controlClasses } from './field';
import { t, type Lang } from '@/lib/i18n';
import type { LanguageState } from '@/lib/auth/language';

/**
 * Language picker for Settings: English or Español. Its own small form and server action, so it never touches the main profile save.
 * Labels come from the dictionary in the member's current language; the two options are always written in their own language.
 */
export function LanguageForm({
  action,
  current,
}: {
  action: (prev: LanguageState, formData: FormData) => Promise<LanguageState>;
  current: Lang;
}) {
  const [state, formAction, pending] = useActionState(action, {} as LanguageState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="language" className="text-sm font-medium text-ink">
          {t(current, 'settings.language.label')}
        </label>
        <select id="language" name="language" defaultValue={current} aria-describedby="language-hint" className={`${controlClasses} max-w-xs`}>
          <option value="en">{t(current, 'lang.en')}</option>
          <option value="es">{t(current, 'lang.es')}</option>
        </select>
        <p id="language-hint" className="text-sm text-muted">
          {t(current, 'settings.language.hint')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          {t(current, 'settings.language.save')}
        </Button>
        <p role="status" className="text-sm text-muted empty:hidden">
          {state.ok && !state.skipped ? state.message : null}
        </p>
        <p role="alert" className="text-sm font-medium text-danger empty:hidden">
          {state.error}
        </p>
      </div>
    </form>
  );
}
