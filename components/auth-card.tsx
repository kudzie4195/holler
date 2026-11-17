import type { ReactNode } from 'react';
import { Card } from './card';

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <>
      <h1 className="text-4xl text-ink">{title}</h1>
      {subtitle ? <p className="mt-3 text-lg text-muted">{subtitle}</p> : null}
      <Card className="mt-8 md:p-7">{children}</Card>
      {footer ? <p className="mt-6 text-center text-sm text-muted">{footer}</p> : null}
    </>
  );
}

export function AuthCardSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="skeleton h-10 w-3/4" />
      <div className="skeleton mt-4 h-6 w-full" />
      <div className="mt-8 rounded-card border border-line bg-surface p-6 shadow-soft">
        <div className="skeleton h-11 w-full" />
        <div className="skeleton mt-5 h-11 w-full" />
        <div className="skeleton mt-5 h-12 w-full" />
      </div>
    </div>
  );
}
