/**
 * The synthetic "Pressure washing" chip (round 23, lib/plan/profile-categories.ts). Kept in this tiny module so server code that only
 * needs to know what the chip stands for (the alert email's address-list link, lib/email/templates.ts) does not import the form's
 * category tables.
 *
 * Pressure washing is not a trade in lib/signals/categories.ts: the chip picks House cleaning and Siding and gutters together, and
 * components/profile-form.tsx turns it into those two ids before the form is submitted, so a saved profile never holds this id.
 */
export const PRESSURE_WASHING_ID = 'pressure-washing';
export const PRESSURE_WASHING_PARTS: readonly string[] = ['cleaning', 'siding-gutters'];

/** The real trade ids behind a chip id: the composite gives its parts, any other id is itself. Order kept, duplicates dropped. */
export function expandTradeIds(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) for (const t of id === PRESSURE_WASHING_ID ? PRESSURE_WASHING_PARTS : [id]) if (!out.includes(t)) out.push(t);
  return out;
}
