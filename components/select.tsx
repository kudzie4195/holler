import { useId } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { Field, controlClasses } from './field';

export function Select({
  label,
  hint,
  error,
  id,
  className = '',
  children,
  ...rest
}: { label: string; hint?: ReactNode; error?: string | null } & ComponentProps<'select'>) {
  const auto = useId();
  const selectId = id ?? auto;
  const describedBy = error ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined;
  return (
    <Field id={selectId} label={label} hint={hint} error={error}>
      <select
        id={selectId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`${controlClasses} ${className}`}
        {...rest}
      >
        {children as ReactNode}
      </select>
    </Field>
  );
}
