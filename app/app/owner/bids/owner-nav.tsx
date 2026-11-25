import Link from 'next/link';

/** The three owner pages for hand-added bids. Owner only; English only (no member sees these pages). */
export function OwnerBidsNav({ current }: { current: 'add' | 'import' | 'checklist' }) {
  const items = [
    { id: 'add', href: '/app/owner/bids', label: 'Quick add' },
    { id: 'import', href: '/app/owner/bids/import', label: 'CSV import' },
    { id: 'checklist', href: '/app/owner/bids/checklist', label: 'Weekly check list' },
  ] as const;
  return (
    <nav aria-label="Hand-added bids" className="mt-4 flex flex-wrap gap-3 text-sm">
      {items.map((i) =>
        i.id === current ? (
          <span key={i.id} aria-current="page" className="rounded-control border border-ink px-3 py-1.5 font-semibold text-ink">
            {i.label}
          </span>
        ) : (
          <Link key={i.id} href={i.href} className="rounded-control border border-line-strong px-3 py-1.5 text-ink underline-offset-2 hover:underline">
            {i.label}
          </Link>
        ),
      )}
    </nav>
  );
}
