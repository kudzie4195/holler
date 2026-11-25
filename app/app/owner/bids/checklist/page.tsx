import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ownerGate } from '@/lib/signals/manual-bids/owner';
import { MANUAL_PORTALS } from '@/lib/signals/manual-bids/portals';
import { OwnerBidsNav } from '../owner-nav';
import { Checklist } from './checklist';

export const metadata: Metadata = {
  title: 'Weekly bid check list',
  robots: { index: false, follow: false },
};

/**
 * Round 33: the owner's check day on one screen. The round 32 manual list (lib/signals/manual-bids/portals.ts), one box per government
 * for "checked this week", kept in this browser only. Holler never opens these pages itself. Owner only, 404 for anyone else.
 */
export default async function OwnerBidsChecklistPage() {
  const gate = await ownerGate();
  if (!gate.ok) notFound();
  return (
    <div>
      <h1 className="font-display text-3xl font-semibold text-ink">Weekly bid check list</h1>
      <p className="mt-2 text-muted">
        Government bid pages Holler does not read automatically. Open each one, add what you find with Quick add or a CSV, then tick it.
        The ticks are saved in this browser only and start fresh every Monday.
      </p>
      <OwnerBidsNav current="checklist" />
      <Checklist metros={MANUAL_PORTALS} />
    </div>
  );
}
