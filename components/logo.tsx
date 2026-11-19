import Link from 'next/link';

/**
 * The mark: a signal-lime tile with ink signal arcs on both sides of a dot. Ink on signal is 13.2:1, so the arcs read on any
 * surface. Decorative; the wordmark (or the link's aria-label) carries the name. public/icon.svg is the same drawing.
 */
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
      <rect width="32" height="32" rx="6" fill="var(--color-signal)" />
      <g transform="translate(6.5 6.5) scale(0.7917)" stroke="var(--color-ink)" strokeWidth="2.4" strokeLinecap="round">
        <circle cx="12" cy="12" r="2" />
        <path d="M8 8a5.7 5.7 0 0 0 0 8M16 8a5.7 5.7 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" />
      </g>
    </svg>
  );
}

/**
 * Mark plus the HOLLER wordmark in the display face. The wordmark takes the text color of where it sits: ink on light,
 * on-brand inside an .on-brand (green or ink) section.
 */
export function Logo({
  href = '/',
  className = '',
  size = 32,
}: {
  href?: string | null;
  className?: string;
  size?: number;
}) {
  const inner = (
    <>
      <LogoMark size={size} />
      <span className="font-display leading-none tracking-[0.01em]" style={{ fontSize: `${Math.round(size * 0.875) / 16}rem` }}>
        Holler
      </span>
    </>
  );
  const cls = `inline-flex shrink-0 items-center gap-2.5 ${className}`;
  if (href === null) return <span className={cls}>{inner}</span>;
  return (
    <Link href={href} className={`${cls} min-h-11`} aria-label="Holler home">
      {inner}
    </Link>
  );
}
