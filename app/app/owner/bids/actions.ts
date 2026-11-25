'use server';

import { ownerServiceDeps as deps } from '@/lib/signals/manual-bids/deps';
import { importCsv, previewCsv, quickAdd, retireBid, type ImportResult, type PreviewResult, type QuickAddResult, type RetireResult } from '@/lib/signals/manual-bids/service';

/**
 * Owner-only server actions for hand-added bids (round 33). Each one asks the owner gate (lib/signals/manual-bids/owner.ts) inside the
 * service before it creates a database client or reads anything, so a call from anyone else (or with HOLLER_MANUAL_BIDS_ENABLED off)
 * gets "Not found." and touches nothing. The service-role client is created and the write path loaded only after the gate.
 */
const str = (v: FormDataEntryValue | null): string => (typeof v === 'string' ? v : '');

/**
 * The result, plus what was typed (after a refusal or a preview, so the form shows it again), and a counter that remounts the form.
 * Quick add has two steps (review 2): `intent` "preview" checks and shows what will be stored, writing nothing; "publish" sends the
 * preview's confirm key, and the server checks everything again and refuses if the fields changed since that preview.
 */
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
    }, str(form.get('intent')) === 'publish' ? str(form.get('confirmKey')).slice(0, 100) : undefined);
    return res.ok && res.step === 'done' ? { ...res, n } : { ...res, values, n };
  } catch {
    return { ok: false, error: 'Something went wrong. Nothing may have been saved; check the matches page before trying again.', values, n };
  }
}

export type RetireState = RetireResult | null;

/** Retires (expires now) a hand-added bid added by mistake. Owner only, checked inside the service before any database client exists. */
export async function retireManualBidAction(_prev: RetireState, form: FormData): Promise<RetireState> {
  try {
    return await retireBid(deps(), str(form.get('id')));
  } catch {
    return { ok: false, error: 'Could not retire it. Try again.' };
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
