import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/notice';
import { CATEGORIES } from '@/lib/signals/categories';
import { bidsEnabled } from '@/lib/signals/bid-sources';
import { ownerGate } from '@/lib/signals/manual-bids/owner';
import { OwnerBidsNav } from './owner-nav';
import { QuickAddForm } from './quick-add-form';

export const metadata: Metadata = {
  title: 'Add a bid',
  robots: { index: false, follow: false },
};

/**
 * Round 33: the owner adds one open bid he found by hand on a government bid page (lib/signals/manual-bids). Owner only, checked on the
 * server here and again in the action; anyone else (and everyone while HOLLER_MANUAL_BIDS_ENABLED is off) gets 404.
 */
export default async function OwnerBidsPage() {
  const gate = await ownerGate();
  if (!gate.ok) notFound();
  const trades = CATEGORIES.map((c) => ({ id: c.id, label: c.label }));
  return (
    <div>
      <h1 className="font-display text-3xl font-semibold text-ink">Add a bid by hand</h1>
      <p className="mt-2 text-muted">
        For open bids you find on government pages Holler does not read. The record is a normal bid: matched to members by trade and
        area, sent in their next alerts, and linked to the agency&apos;s own page as the public source.
      </p>
      <OwnerBidsNav current="add" />
      {!bidsEnabled() ? (
        <div className="mt-6">
          <Notice tone="warn" role="status">
            HOLLER_BIDS_ENABLED is off, so no bid reaches a member and publishing is refused. Turn it on first.
          </Notice>
        </div>
      ) : null}
      <QuickAddForm trades={trades} />
    </div>
  );
}
