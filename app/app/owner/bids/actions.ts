'use server';

import { ownerGate } from '@/lib/signals/manual-bids/owner';
import { importCsv, previewCsv, quickAdd, type ImportResult, type PreviewResult, type QuickAddResult, type ServiceDeps } from '@/lib/signals/manual-bids/service';
import { bidsEnabled } from '@/lib/signals/bid-sources';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Owner-only server actions for hand-added bids (round 33). Each one asks the owner gate (lib/signals/manual-bids/owner.ts) inside the
 * service before it creates a database client or reads anything, so a call from anyone else (or with HOLLER_MANUAL_BIDS_ENABLED off)
 * gets "Not found." and touches nothing. The service-role client is created and the write path loaded only after the gate.
 */
function deps(): ServiceDeps {
  return {
    gate: ownerGate,
    // Called only after the gate passes, so a refused call never builds the service-role client.
    db: () => createAdminClient(),
    now: () => new Date(),
    bidsOn: () => bidsEnabled(),
    findExisting: async (db, cands) => (await import('@/lib/signals/manual-bids/store')).findExisting(db, cands),
    publish: async (db, items, now) => (await import('@/lib/signals/manual-bids/store')).publishManualBids(db, items, now),
  };
}

const str = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

/** The result, plus (after a refusal) what was typed so the form can show it again, and a counter that remounts the form. */
export type QuickAddState = (QuickAddResult & { values?: Record<string, string>; n: number }) | null;

const QUICK_FIELDS = ['url', 'title', 'agency', 'dueDate', 'place', 'solicitationId', 'trade'] as const;

export async function addManualBidAction(prev: QuickAddState, form: FormData): Promise<QuickAddState> {
  const n = (prev?.n ?? 0) + 1;
  const values = Object.fromEntries(QUICK_FIELDS.map((k) => [k, str(form.get(k)).slice(0, 600)]));
  try {
    const res = await quickAdd(deps(), {
      url: values.url,
      title: values.title,
      agency: values.agency,
      dueDate: values.dueDate,
      place: values.place,
      solicitationId: values.solicitationId,
      trade: values.trade,
    });
    return res.ok ? { ...res, n } : { ...res, values, n };
  } catch {
    return { ok: false, error: 'Something went wrong. Nothing may have been saved; check the matches page before trying again.', values, n };
  }
}

export type CsvState = { step: 'preview'; result: PreviewResult } | { step: 'import'; result: ImportResult } | null;

/** One action for both steps: `intent` "preview" reads only; "import" re-reads the same text from scratch and publishes the add rows. */
export async function csvAction(_prev: CsvState, form: FormData): Promise<CsvState> {
  const text = str(form.get('csv'));
  const format = str(form.get('format'));
  try {
    if (str(form.get('intent')) === 'import') return { step: 'import', result: await importCsv(deps(), text, format) };
    return { step: 'preview', result: await previewCsv(deps(), text, format) };
  } catch {
    return { step: 'preview', result: { ok: false, error: 'db_failed' } };
  }
}
