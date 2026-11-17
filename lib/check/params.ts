import { isCategoryId, type CategoryId } from '@/lib/signals/categories';

export type CheckParams =
  | { status: 'empty' }
  | { status: 'invalid'; zip: string; trade: string; zipError?: string; tradeError?: string }
  | { status: 'ok'; zip: string; trade: CategoryId };

type Raw = string | string[] | undefined | null;

function first(v: Raw): string {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s.trim().slice(0, 40) : '';
}

/** Validates ?zip= and ?trade=. Pure: no ZIP database lookup here (the page does that). */
export function parseCheckParams(sp: { zip?: Raw; trade?: Raw }): CheckParams {
  const zipRaw = first(sp.zip);
  const trade = first(sp.trade);
  if (!zipRaw && !trade) return { status: 'empty' };

  const m = /^(\d{5})(?:-\d{4})?$/.exec(zipRaw);
  const zip = m ? m[1] : '';
  const zipError = zip ? undefined : zipRaw ? 'Enter a 5-digit ZIP code, like 30030.' : 'Enter your ZIP code.';
  const tradeError = trade && isCategoryId(trade) ? undefined : trade ? 'Pick a trade from the list.' : 'Pick what you do.';

  if (zipError || tradeError) return { status: 'invalid', zip: zipRaw, trade, zipError, tradeError };
  return { status: 'ok', zip, trade: trade as CategoryId };
}
