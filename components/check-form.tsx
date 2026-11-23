import { Button } from './button';
import { Input } from './input';
import { Select } from './select';
import { tradeGroups } from '@/lib/check/trades';
import { tradeComingSoon } from '@/lib/seo/signal-types';
import { tradeNoLiveSource } from '@/lib/signals/lead-rules';
import { t, type Lang } from '@/lib/i18n';

/**
 * The trade options of the check form and of the waitlist card, built on the server. Exported so components/area-waitlist.tsx (a client
 * component) is given the same list instead of building its own.
 */
export function checkTradeGroups(trade = '', lang: Lang = 'en') {
  return tradeGroups(lang)
    .map((g) => ({
      ...g,
      options: g.options
        .filter((o) => o.id === trade || (!tradeComingSoon(o.id) && !tradeNoLiveSource(o.id)))
        .map((o) => (o.id === 'cleaning' ? { ...o, label: t(lang, 'chk.trade.cleaning') } : o)),
    }))
    .filter((g) => g.options.length > 0);
}

/** Plain GET form to /check. No client JS needed, so it works in the landing hero too. */
export function CheckForm({
  zip = '',
  trade = '',
  zipError,
  tradeError,
  submitLabel,
  idPrefix = 'check',
  prompt,
  lang = 'en',
}: {
  zip?: string;
  trade?: string;
  zipError?: string;
  tradeError?: string;
  submitLabel?: string;
  idPrefix?: string;
  /** A neutral next-step line above the fields (not an error), such as "Now pick your trade" after the home page ZIP form. */
  prompt?: string;
  /** 'es' writes the labels in Spanish and sends the form to /es/check. English (the default) is unchanged. */
  lang?: Lang;
}) {
  // A trade that no record type can reach on this deployment (childcare and beauty without a people-asking key) is left out, as onboarding
  // disables it; one that arrives in the URL stays so the visitor's own choice still shows. Groups left empty are dropped.
  // Round 23: a trade no live source reaches (Locksmith, "Bookkeeping, payroll and IT setup") is left out too. It was pickable here and
  // refused at sign-up, so a visitor could check it, get "nothing matched", and then not find it on the form.
  // House cleaning also says "and pressure washing": that category is where the pressure-washing keywords live, so a washer picking by
  // name now finds it instead of guessing (lib/signals/categories.ts, lib/plan/profile-categories.ts PRESSURE_WASHING_PARTS).
  const groups = checkTradeGroups(trade, lang);
  return (
    // Layout follows the width of the box the form sits in (container queries), not the screen: the home hero column is about
    // 520px on a desktop, /check is wider, phones are narrow. Narrow: one column. From 24rem: ZIP and trade side by side, button on its
    // own row, so the trade select never shrinks to a sliver beside the long button. From 48rem: all three in one row.
    <div className="@container">
      {prompt ? (
        <p id={`${idPrefix}-prompt`} className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {zip ? <span className="font-mono text-sm uppercase tracking-[0.06em] text-brand-text">ZIP {zip}</span> : null}
          <span className="text-lg font-semibold text-ink">{prompt}</span>
        </p>
      ) : null}
      <form
        aria-describedby={prompt ? `${idPrefix}-prompt` : undefined}
        action={lang === 'es' ? '/es/check' : '/check'} method="get" noValidate className="grid grid-cols-1 gap-4 @sm:grid-cols-[8rem_minmax(0,1fr)] @3xl:grid-cols-[8rem_minmax(0,1fr)_auto] @3xl:items-start">
        <div className="min-w-0">
          <Input
            id={`${idPrefix}-zip`}
            name="zip"
            label={t(lang, 'chk.zip')}
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={10}
            placeholder="30030"
            defaultValue={zip}
            error={zipError}
          />
        </div>
        <div className="min-w-0">
          <Select id={`${idPrefix}-trade`} name="trade" label={t(lang, 'chk.trade')} defaultValue={trade} error={tradeError}>
            <option value="">{t(lang, 'chk.pick')}</option>
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
            {submitLabel ?? t(lang, 'chk.submit')}
          </Button>
        </div>
      </form>
    </div>
  );
}
