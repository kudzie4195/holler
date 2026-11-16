import type { ReactNode } from 'react';

/** Shared label + hint + error wrapper for Input, Select and Slider. */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const controlClasses =
  'w-full min-h-11 rounded-xl border border-line bg-surface px-4 text-base text-ink placeholder:text-muted/70 transition-colors hover:border-ink/40 focus-visible:border-accent aria-[invalid=true]:border-danger disabled:opacity-60';
