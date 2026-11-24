import { isCategoryId, type CategoryId } from '@/lib/signals/categories';
import { PRESSURE_WASHING_ID } from '@/lib/plan/composite-trades';

/** Round 25: a /check trade is a category id or the composite "Pressure washing" chip (cleaning AND siding-gutters, as sign-up saves it). */
export type CheckTradeId = CategoryId | typeof PRESSURE_WASHING_ID;

export function isCheckTradeId(v: string): v is CheckTradeId {
  return isCategoryId(v) || v === PRESSURE_WASHING_ID;
}

export type CheckParams =
  | { status: 'empty' }
  // A valid ZIP and no trade at all: the home page ZIP form sends this. Not an error: the page asks for the trade next.
  | { status: 'zip'; zip: string }
  | { status: 'invalid'; zip: string; trade: string; zipError?: string; tradeError?: string }
  | { status: 'ok'; zip: string; trade: CheckTradeId };

type Raw = string | string[] | undefined | null;

function first(v: Raw): string {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s.trim().slice(0, 40) : '';
}

/** The message a caller that needs both fields (the mobile API) shows for the 'zip' step. Same words as before the step existed. */
export const MISSING_TRADE = 'Pick what you do.';

/** Validates ?zip= and ?trade=. Pure: no ZIP database lookup here (the page does that). */
export function parseCheckParams(sp: { zip?: Raw; trade?: Raw }): CheckParams {
  const zipRaw = first(sp.zip);
  const trade = first(sp.trade);
  if (!zipRaw && !trade) return { status: 'empty' };

  const m = /^(\d{5})(?:-\d{4})?$/.exec(zipRaw);
  const zip = m ? m[1] : '';
  if (zip && !trade) return { status: 'zip', zip };

  const zipError = zip ? undefined : zipRaw ? 'Enter a 5-digit ZIP code, like 30030.' : 'Enter your ZIP code.';
  // An empty trade only gets here with a bad ZIP (a typo in the home page ZIP form, which sends no trade). It shows only the ZIP
  // message: the trade was never asked for yet. With a good ZIP it is the 'zip' step above.
  const tradeError = !trade || isCheckTradeId(trade) ? undefined : 'Pick a trade from the list.';

  if (zipError || tradeError) return { status: 'invalid', zip: zipRaw, trade, zipError, tradeError };
  return { status: 'ok', zip, trade: trade as CheckTradeId };
}
