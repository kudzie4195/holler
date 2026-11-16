import { useId } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { Field, controlClasses } from './field';

export function Input({
  label,
  hint,
  error,
  id,
  className = '',
  ...rest
}: { label: string; hint?: ReactNode; error?: string | null } & ComponentProps<'input'>) {
  const auto = useId();
  const inputId = id ?? auto;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <Field id={inputId} label={label} hint={hint} error={error}>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`${controlClasses} ${className}`}
        {...rest}
      />
    </Field>
  );
}
