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
      <h2 className="text-2xl text-ink">{title}</h2>
      {children ? <div className="mx-auto mt-3 max-w-md text-muted">{children}</div> : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}
