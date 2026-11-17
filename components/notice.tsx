import type { ReactNode } from 'react';

const tones = {
  info: 'bg-accent-soft text-ink border-accent/30',
  success: 'bg-success-soft text-success-ink border-success/30',
  warn: 'bg-warn-soft text-warn-ink border-warn/30',
  danger: 'bg-danger-soft text-danger border-danger/30',
} as const;

export function Notice({
  tone = 'info',
  children,
  role,
}: {
  tone?: keyof typeof tones;
  children: ReactNode;
  role?: 'alert' | 'status';
}) {
  return (
    <div role={role} className={`rounded-control border px-4 py-3 text-sm leading-relaxed ${tones[tone]}`}>
      {children}
    </div>
  );
}
