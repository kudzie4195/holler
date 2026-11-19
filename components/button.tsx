import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

/**
 * primary: brand fill, on-brand text (11.2:1). For light surfaces.
 * signal: signal fill, ink text (13.2:1). Only on green or ink surfaces (inside .on-brand), never on light. Hover: the darker
 *   signal-hover fill (ink 11.0:1), easier to see on lime than a brightness change.
 * secondary: surface fill, line-strong edge (3:1 or better on every light surface), ink text.
 * ghost: no fill, takes the text color of where it sits, so it works on light and inside .on-brand.
 * outline-signal: transparent, 1.5 px signal edge (9.7:1 on brand), on-brand text. The nav "Start free" on green.
 */
export type ButtonVariant = 'primary' | 'signal' | 'secondary' | 'ghost' | 'outline-signal';
export type ButtonSize = 'md' | 'sm' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-control font-semibold whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow,filter] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-raised active:bg-brand-deep',
  signal: 'bg-signal text-ink hover:bg-signal-hover',
  secondary: 'border border-line-strong bg-surface text-ink hover:border-ink hover:bg-sand',
  ghost: 'bg-transparent text-current hover:bg-current/10',
  'outline-signal': 'border-[1.5px] border-signal bg-transparent text-on-brand hover:bg-signal hover:text-ink',
};

const sizes: Record<ButtonSize, string> = {
  lg: 'min-h-12 px-6 text-base',
  md: 'min-h-11 px-5 text-base',
  // 44 px everywhere except with a mouse or trackpad (fine pointer), where 36 px is enough.
  sm: 'min-h-11 px-4 text-sm pointer-fine:min-h-9',
};

export function buttonClasses({
  variant = 'primary',
  size = 'md',
  full = false,
  className = '',
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  className?: string;
} = {}) {
  return `${base} ${variants[variant]} ${sizes[size]} ${full ? 'w-full' : ''} ${className}`.trim();
}

type CommonProps = { variant?: ButtonVariant; size?: ButtonSize; full?: boolean };

export function Button({
  variant,
  size,
  full,
  className,
  type = 'button',
  children,
  ...rest
}: CommonProps & ComponentProps<'button'>) {
  return (
    <button type={type} className={buttonClasses({ variant, size, full, className })} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({
  variant,
  size,
  full,
  className,
  children,
  ...rest
}: CommonProps & ComponentProps<typeof Link> & { children: ReactNode }) {
  return (
    <Link className={buttonClasses({ variant, size, full, className })} {...rest}>
      {children}
    </Link>
  );
}
