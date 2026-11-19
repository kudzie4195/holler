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

/**
 * Used by Input, Select, PasswordInput and the request textareas. border-line-strong is 3:1 or better on surface, background and
 * sand (WCAG 1.4.11); the focus ring (ink, from globals.css) sits outside the edge. Placeholder: muted, 6.2:1 on surface.
 */
export const controlClasses =
  'w-full min-h-11 rounded-control border border-line-strong bg-surface px-4 text-base text-ink placeholder:text-muted transition-colors hover:border-ink focus-visible:border-ink aria-[invalid=true]:border-danger disabled:opacity-60';
