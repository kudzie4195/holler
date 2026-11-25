import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/notice';
import { bidsEnabled } from '@/lib/signals/bid-sources';
import { ownerGate } from '@/lib/signals/manual-bids/owner';
import { CSV_FIELDS, CSV_FORMATS } from '@/lib/signals/manual-bids/csv';
import { OwnerBidsNav } from '../owner-nav';
import { ImportForm } from './import-form';

export const metadata: Metadata = {
  title: 'Import bids',
  robots: { index: false, follow: false },
};

/** Round 33: CSV import of bids the owner exported by hand. Preview first (reads only), then confirm. Owner only, 404 for anyone else. */
export default async function OwnerBidsImportPage() {
  const gate = await ownerGate();
  if (!gate.ok) notFound();
  const formats = Object.values(CSV_FORMATS).map((f) => ({ id: f.id, label: f.label, confirmed: f.confirmed }));
  return (
    <div>
      <h1 className="font-display text-3xl font-semibold text-ink">Import bids from a CSV file</h1>
      <p className="mt-2 text-muted">
        Upload, check the preview (nothing is saved yet), then confirm. Rows that are closed, already in Holler, repeated in the file or
        outside the areas Holler serves are skipped and listed with the reason.
      </p>
      <OwnerBidsNav current="import" />
      <div className="mt-6 flex flex-col gap-3">
        {!bidsEnabled() ? (
          <Notice tone="warn" role="status">
            HOLLER_BIDS_ENABLED is off: the preview works, but nothing can be published until it is on.
          </Notice>
        ) : null}
        <Notice tone="info">
          Generic format header row: <code>{CSV_FIELDS.join(',')}</code>. Required: title, agency, due_date, url (https). Place: zip, or
          city and state. The Texas ESBD column names are not confirmed yet; send one real export so they can be set.
        </Notice>
      </div>
      <ImportForm formats={formats} />
    </div>
  );
}
