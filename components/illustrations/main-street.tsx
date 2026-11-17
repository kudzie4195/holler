/**
 * Decorative main-street scene for the home hero: three shopfronts, a work van and a cloud.
 * Drawn with the palette tokens so it follows any token change. aria-hidden; carries no information.
 */
export function MainStreet({ className = '' }: { className?: string }) {
  const line = 'var(--color-ink)';
  return (
    <svg
      viewBox="0 0 480 200"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* sky and cloud */}
      <rect x="0" y="0" width="480" height="200" rx="20" fill="var(--color-sky)" />
      <path
        d="M318 46c0-10 8-17 18-17 6 0 11 3 14 7 3-2 6-3 9-3 9 0 15 6 15 14h4c6 0 10 4 10 9s-4 9-10 9h-58c-7 0-12-5-12-10 0-5 4-9 10-9z"
        fill="var(--color-surface)"
        stroke={line}
        strokeWidth="2"
      />
      <circle cx="80" cy="42" r="14" fill="var(--color-accent-soft)" stroke="var(--color-accent)" strokeWidth="2" />

      {/* ground */}
      <path d="M0 170h480v10a20 20 0 0 1-20 20H20A20 20 0 0 1 0 180z" fill="var(--color-sand)" />
      <path d="M10 170h460" stroke={line} strokeWidth="2" />

      {/* shop 1: hardware */}
      <path d="M28 170V92h112v78" fill="var(--color-surface)" stroke={line} strokeWidth="2" />
      <path d="M22 92l10-18h104l10 18z" fill="var(--color-accent)" stroke={line} strokeWidth="2" />
      <path d="M45 92v8M68 92v8M91 92v8M114 92v8" stroke={line} strokeWidth="1.5" />
      <rect x="40" y="110" width="40" height="34" rx="3" fill="var(--color-sky)" stroke={line} strokeWidth="2" />
      <path d="M92 170v-50h32v50" fill="var(--color-sage)" stroke={line} strokeWidth="2" />
      <circle cx="117" cy="146" r="1.8" fill={line} />

      {/* shop 2: tall brick */}
      <path d="M150 170V62h96v108" fill="var(--color-brick)" stroke={line} strokeWidth="2" />
      <path d="M150 62l8-10h80l8 10" fill="var(--color-line)" stroke={line} strokeWidth="2" />
      <rect x="164" y="76" width="22" height="26" rx="2" fill="var(--color-surface)" stroke={line} strokeWidth="2" />
      <rect x="210" y="76" width="22" height="26" rx="2" fill="var(--color-surface)" stroke={line} strokeWidth="2" />
      <rect x="160" y="118" width="76" height="14" rx="3" fill="var(--color-surface)" stroke={line} strokeWidth="2" />
      <path d="M172 125h52" stroke="var(--color-accent)" strokeWidth="2" />
      <path d="M182 170v-28h32v28" fill="var(--color-sky)" stroke={line} strokeWidth="2" />

      {/* shop 3: cafe with awning */}
      <path d="M256 170v-62h92v62" fill="var(--color-surface)" stroke={line} strokeWidth="2" />
      <path d="M250 108l8-14h88l8 14z" fill="var(--color-sage)" stroke={line} strokeWidth="2" />
      <path d="M250 108q11 10 22 0q11 10 22 0q11 10 22 0q11 10 22 0q8 7 16 0" fill="var(--color-sage)" stroke={line} strokeWidth="2" />
      <rect x="268" y="126" width="34" height="26" rx="3" fill="var(--color-sky)" stroke={line} strokeWidth="2" />
      <path d="M314 170v-44h24v44" fill="var(--color-sand)" stroke={line} strokeWidth="2" />

      {/* tree */}
      <path d="M362 170v-26" stroke={line} strokeWidth="2.5" />
      <circle cx="362" cy="130" r="15" fill="var(--color-sage)" stroke={line} strokeWidth="2" />

      {/* work van with ladder */}
      <g transform="translate(20 0)">
        <path d="M398 132h22l12 14h12a6 6 0 0 1 6 6v12h-52z" fill="var(--color-surface)" stroke={line} strokeWidth="2" />
        <rect x="350" y="132" width="50" height="32" rx="4" fill="var(--color-surface)" stroke={line} strokeWidth="2" />
        <path d="M402 136h14l8 10h-22z" fill="var(--color-sky)" stroke={line} strokeWidth="1.5" />
        <path d="M352 150h96" stroke="var(--color-accent)" strokeWidth="3" />
        <path d="M354 126h56M354 132v-6M368 132v-6M382 132v-6M396 132v-6M410 132v-6" stroke={line} strokeWidth="1.5" />
        <circle cx="368" cy="166" r="8" fill="var(--color-ink)" />
        <circle cx="368" cy="166" r="3" fill="var(--color-line)" />
        <circle cx="430" cy="166" r="8" fill="var(--color-ink)" />
        <circle cx="430" cy="166" r="3" fill="var(--color-line)" />
      </g>
    </svg>
  );
}
