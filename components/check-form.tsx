import { Button } from './button';
import { Input } from './input';
import { Select } from './select';
import { tradeGroups } from '@/lib/check/trades';
import { tradeComingSoon } from '@/lib/seo/signal-types';

/** Plain GET form to /check. No client JS needed, so it works in the landing hero too. */
export function CheckForm({
  zip = '',
  trade = '',
  zipError,
  tradeError,
  submitLabel = 'See what happened near you',
  idPrefix = 'check',
}: {
  zip?: string;
  trade?: string;
  zipError?: string;
  tradeError?: string;
  submitLabel?: string;
  idPrefix?: string;
}) {
  // A trade that no record type can reach on this deployment (childcare and beauty without a people-asking key) is left out, as onboarding
  // disables it; one that arrives in the URL stays so the visitor's own choice still shows. Groups left empty are dropped.
  const groups = tradeGroups()
    .map((g) => ({ ...g, options: g.options.filter((o) => o.id === trade || !tradeComingSoon(o.id)) }))
    .filter((g) => g.options.length > 0);
  return (
    // Layout follows the width of the box the form sits in (container queries), not the screen: the home hero column is about
    // 520px on a desktop, /check is wider, phones are narrow. Narrow: one column. From 24rem: ZIP and trade side by side, button on its
    // own row, so the trade select never shrinks to a sliver beside the long button. From 48rem: all three in one row.
    <div className="@container">
      <form action="/check" method="get" noValidate className="grid grid-cols-1 gap-4 @sm:grid-cols-[8rem_minmax(0,1fr)] @3xl:grid-cols-[8rem_minmax(0,1fr)_auto] @3xl:items-start">
        <div className="min-w-0">
          <Input
            id={`${idPrefix}-zip`}
            name="zip"
            label="ZIP code"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={10}
            placeholder="30030"
            defaultValue={zip}
            error={zipError}
          />
        </div>
        <div className="min-w-0">
          <Select id={`${idPrefix}-trade`} name="trade" label="What you do" defaultValue={trade} error={tradeError}>
            <option value="">Pick a trade</option>
            {groups.map((g) =>
              g.label ? (
                <optgroup key={g.label} label={g.label}>
                  {g.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ) : (
                g.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))
              ),
            )}
          </Select>
        </div>
        <div className="@sm:col-span-2 @3xl:col-span-1 @3xl:pt-[1.625rem]">
          <Button type="submit" size="md" full className="@sm:w-auto">
            {submitLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}
