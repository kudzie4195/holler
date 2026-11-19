import type { ReactNode } from 'react';

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-line bg-surface px-6 py-10 text-center">
      <svg className="mx-auto mb-4 text-line-strong" width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <circle cx="24" cy="24" r="22" fill="var(--color-sand)" />
        <path d="M15 27h18M18 22h12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="24" cy="15" r="2.5" fill="var(--color-brand)" />
      </svg>
      <h2 className="h-plain text-2xl text-ink">{title}</h2>
      {children ? <div className="mx-auto mt-3 max-w-md text-muted">{children}</div> : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}
