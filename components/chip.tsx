import type { ComponentProps, ReactNode } from 'react';

const base = 'inline-flex items-center justify-center border px-4 text-sm font-medium transition-colors duration-150';

/** Toggle chip. Renders a real button with aria-pressed. */
export function Chip({
  selected = false,
  className = '',
  children,
  ...rest
}: { selected?: boolean; children: ReactNode } & ComponentProps<'button'>) {
  // Selected: brand fill, on-brand text (11.2:1). Not selected: line-strong edge, 3:1 or better on every light surface.
  const state = selected
    ? 'bg-brand text-on-brand border-brand hover:bg-brand-raised'
    : 'bg-surface text-ink border-line-strong hover:border-ink hover:bg-sand disabled:opacity-40 disabled:hover:border-line-strong';
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`${base} min-h-11 rounded-control ${state} ${className}`}
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
      className={`${base} min-h-9 rounded-chip border-line bg-surface text-ink ${className}`}
    >
      {children}
    </span>
  );
}
