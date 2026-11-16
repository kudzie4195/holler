import type { ComponentProps, ReactNode } from 'react';

const base =
  'inline-flex items-center justify-center rounded-full border px-4 text-sm font-medium transition-colors duration-150';

/** Toggle chip. Renders a real button with aria-pressed. */
export function Chip({
  selected = false,
  className = '',
  children,
  ...rest
}: { selected?: boolean; children: ReactNode } & ComponentProps<'button'>) {
  const state = selected
    ? 'bg-ink text-white border-ink'
    : 'bg-surface text-ink border-line hover:border-ink/40 disabled:opacity-40 disabled:hover:border-line';
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`${base} min-h-11 ${state} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Non-interactive chip for lists such as "who it's for". */
export function StaticChip({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`${base} min-h-9 border-line bg-surface text-ink ${className}`}
    >
      {children}
    </span>
  );
}
