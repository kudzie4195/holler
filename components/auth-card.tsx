import type { ReactNode } from 'react';
import { Card } from './card';

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
  note,
}: {
  title: string;
  subtitle?: string;
  /** Round 24 FIX2: one line under the subtitle (the "Check your ZIP" link on a sign-up from a waitlist city). */
  note?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <>
      <h1 className="break-words text-5xl text-ink">{title}</h1>
      {/* One child slot for both lines, so the form's generated ids (useId) are the same as before the note existed. */}
      {subtitle || note ? (
        <>
          {subtitle ? <p className="mt-3 text-lg text-muted">{subtitle}</p> : null}
          {note ? <p className="mt-3 text-lg">{note}</p> : null}
        </>
      ) : null}
      <Card className="mt-8 md:p-7">{children}</Card>
      {footer ? <p className="mt-6 text-sm text-muted">{footer}</p> : null}
    </>
  );
}

export function AuthCardSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="skeleton h-10 w-3/4" />
      <div className="skeleton mt-4 h-6 w-full" />
      <div className="mt-8 rounded-card border border-line bg-surface p-6">
        <div className="skeleton h-11 w-full" />
        <div className="skeleton mt-5 h-11 w-full" />
        <div className="skeleton mt-5 h-12 w-full" />
      </div>
    </div>
  );
}
