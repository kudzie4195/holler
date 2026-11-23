'use client';

import { useActionState } from 'react';
import { Button } from './button';
import { controlClasses } from './field';
import { t, type Lang } from '@/lib/i18n';
import type { WorkProfileState } from '@/lib/auth/work-profile';
import { PROPERTY_FOCUS, WORK_TYPES, type WorkProfile } from '@/lib/signals/work-profile';

/**
 * "What work do you take?" in Settings (round 18, migration 0027): property type, kind of work and the smallest job. Its own small form and
 * server action, so it never touches the main profile save. Text comes from the dictionary in the member's language.
 */
export function WorkProfileForm({
  action,
  current,
  lang,
}: {
  action: (prev: WorkProfileState, formData: FormData) => Promise<WorkProfileState>;
  current: WorkProfile;
  lang: Lang;
}) {
  const [state, formAction, pending] = useActionState(action, {} as WorkProfileState);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <p id="work-hint" className="text-sm text-muted">
        {t(lang, 'settings.work.hint')}
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor="work_property" className="text-sm font-medium text-ink">
          {t(lang, 'settings.work.property.label')}
        </label>
        <select id="work_property" name="work_property" defaultValue={current.property} aria-describedby="work-hint" className={`${controlClasses} max-w-xs`}>
          {PROPERTY_FOCUS.map((p) => (
            <option key={p} value={p}>
              {t(lang, `settings.work.property.${p}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="work_type" className="text-sm font-medium text-ink">
          {t(lang, 'settings.work.type.label')}
        </label>
        <select id="work_type" name="work_type" defaultValue={current.workType} aria-describedby="work-hint" className={`${controlClasses} max-w-xs`}>
          {WORK_TYPES.map((w) => (
            <option key={w} value={w}>
              {t(lang, `settings.work.type.${w}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="work_min_value" className="text-sm font-medium text-ink">
          {t(lang, 'settings.work.min.label')}
        </label>
        <input
          id="work_min_value"
          name="work_min_value"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={current.minValue === null ? '' : String(current.minValue)}
          aria-describedby="work-min-hint"
          className={`${controlClasses} max-w-xs font-mono tabular-nums`}
        />
        <p id="work-min-hint" className="text-sm text-muted">
          {t(lang, 'settings.work.min.hint')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          {t(lang, 'settings.work.save')}
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
