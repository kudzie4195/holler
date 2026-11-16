'use client';

import { useId, useState } from 'react';
import type { ComponentProps } from 'react';
import { Field, controlClasses } from './field';

/** Password field with a Show/Hide toggle (44 px target, announces state). */
export function PasswordInput({
  label,
  hint,
  error,
  ...rest
}: { label: string; hint?: string; error?: string | null } & Omit<ComponentProps<'input'>, 'type'>) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <div className="relative">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={`${controlClasses} pr-20`}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-pressed={shown}
          className="absolute right-1 top-0 flex h-full min-w-16 items-center justify-center rounded-full px-3 text-sm font-semibold text-muted hover:text-ink"
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      </div>
    </Field>
  );
}
