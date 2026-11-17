import { Button } from './button';
import { Input } from './input';
import { Select } from './select';
import { tradeGroups } from '@/lib/check/trades';

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
  const groups = tradeGroups();
  return (
    <form action="/check" method="get" noValidate className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="sm:w-32">
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
      <div className="sm:min-w-0 sm:flex-1">
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
      <div className="sm:pt-[1.625rem]">
        <Button type="submit" size="md" full className="sm:w-auto">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
