import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'md' | 'sm' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap select-none transition-[color,background-color,border-color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  // Ink text on accent: 5.0:1. White on #E8590C would be 3.6:1 and fail AA.
  primary: 'bg-accent text-ink shadow-soft hover:bg-accent-bright hover:shadow-lift active:bg-accent-bright',
  secondary: 'bg-surface text-ink border border-line shadow-soft hover:border-ink/40 hover:bg-sand',
  ghost: 'bg-transparent text-ink hover:bg-sand',
};

const sizes: Record<ButtonSize, string> = {
  lg: 'min-h-12 px-7 text-base',
  md: 'min-h-11 px-5 text-base',
  // 44 px on touch, tighter on desktop pointers.
  sm: 'min-h-11 px-4 text-sm md:min-h-9',
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
