import Link from 'next/link';

/** Original mark: a dot with signal arcs on both sides. Decorative; the wordmark carries the name. */
export function LogoMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect width="32" height="32" rx="9" fill="#E8590C" />
      <circle cx="16" cy="16" r="3.2" fill="#FFFFFF" />
      <path d="M21.36 11.5A7 7 0 0 1 21.36 20.5M10.64 11.5A7 7 0 0 0 10.64 20.5" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M24.81 8.61A11.5 11.5 0 0 1 24.81 23.39M7.19 8.61A11.5 11.5 0 0 0 7.19 23.39" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

export function Logo({
  href = '/',
  className = '',
  size = 28,
}: {
  href?: string | null;
  className?: string;
  size?: number;
}) {
  const inner = (
    <>
      <LogoMark size={size} />
      <span className="font-display text-xl font-semibold tracking-[-0.025em] text-ink">holler</span>
    </>
  );
  const cls = `inline-flex items-center gap-2 ${className}`;
  if (href === null) return <span className={cls}>{inner}</span>;
  return (
    <Link href={href} className={`${cls} min-h-11`} aria-label="Holler home">
      {inner}
    </Link>
  );
}
