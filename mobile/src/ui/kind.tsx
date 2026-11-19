// Record families for the alert tag and the card stripe. Colour never carries the meaning alone: every tag has an icon and a label.
import type { AlertDto } from '../contract';

export type Family = 'weather' | 'permit' | 'civic';

export function family(kind: string): Family {
  if (kind === 'alert' || kind === 'report' || kind === 'disaster' || kind === 'quake') return 'weather';
  if (kind === 'permit' || kind === 'contract') return 'permit';
  return 'civic';
}

export function tagLabel(item: Pick<AlertDto, 'kind' | 'source'>): string {
  if (item.kind === 'alert') return 'Weather alert';
  if (item.kind === 'report') return 'Storm report';
  if (item.kind === 'permit') return 'Permit';
  if (item.kind === 'contract') return 'Federal contract';
  const fam = family(item.kind);
  if (fam === 'weather') return 'Weather alert';
  const source = (item.source ?? '').toLowerCase();
  if (source.includes('311')) return '311 request';
  if (source.includes('violation')) return 'Code violation';
  return 'City record';
}

const common = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: false,
};

export function FamilyIcon({ fam }: { fam: Family }) {
  if (fam === 'weather') {
    // cloud with lightning
    return (
      <svg {...common}>
        <path d="M17.5 16.5h.5a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.6 9.2 3.7 3.7 0 0 0 6.5 16.5" />
        <path d="m12.5 12-2.5 4h4l-2.5 4" />
      </svg>
    );
  }
  if (fam === 'permit') {
    // document
    return (
      <svg {...common}>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5" />
        <path d="M9 13h6M9 17h4" />
      </svg>
    );
  }
  // megaphone
  return (
    <svg {...common}>
      <path d="M3 10v4a1 1 0 0 0 1 1h3l6 4V5L7 9H4a1 1 0 0 0-1 1z" />
      <path d="M17 9a4 4 0 0 1 0 6" />
      <path d="M7 15l1 5h2.5l-1-4.3" />
    </svg>
  );
}

export function KindTag({ item }: { item: Pick<AlertDto, 'kind' | 'source'> }) {
  const fam = family(item.kind);
  return (
    <span className={`kind-tag kind-${fam}`}>
      <FamilyIcon fam={fam} />
      {tagLabel(item)}
    </span>
  );
}
