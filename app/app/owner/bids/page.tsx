import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/notice';
import { CATEGORIES } from '@/lib/signals/categories';
import { bidsEnabled } from '@/lib/signals/bid-sources';
import { ownerGate } from '@/lib/signals/manual-bids/owner';
import { OwnerBidsNav } from './owner-nav';
import { QuickAddForm } from './quick-add-form';
import { RetireForm } from './retire-form';
import { listBids } from '@/lib/signals/manual-bids/service';
import { ownerServiceDeps } from '@/lib/signals/manual-bids/deps';

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
  const open = await listBids(ownerServiceDeps());
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
      <section className="mt-12" aria-labelledby="open-manual-bids">
        <h2 id="open-manual-bids" className="font-display text-xl font-semibold text-ink">
          Open bids you added
        </h2>
        <p className="mt-1 text-sm text-muted">Added one by mistake? Retire it: it closes now and leaves every member&apos;s feed, e-mail and push.</p>
        {open.length === 0 ? (
          <p className="mt-3 text-sm text-muted">None open.</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-line rounded-card border border-line bg-surface">
            {open.map((b) => (
              <li key={b.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{b.title}</p>
                  <p className="text-muted">
                    {b.buyer ?? ''}
                    {b.dueDate ? `, due ${b.dueDate}` : ''}
                  </p>
                </div>
                <RetireForm id={b.id} title={b.title} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
