'use client';

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';
import { Button, ButtonLink } from './button';
import { Chip } from './chip';
import { Input } from './input';
import { Notice } from './notice';
import { Slider } from './slider';
import type { ProfileFormState } from '@/lib/auth/profile-types';
import { KEYWORD_MAX_LENGTH, KEYWORD_MIN_LENGTH, PLAN_LIMITS, type Tier } from '@/lib/plan/limits';
import { COMING_SOON_GROUP_KEY, groupCategories, MARKETED_GROUP_KEY, toggleTrade, tradeLimitView, type ChipCategory } from './profile-form-groups';
import { PRESSURE_WASHING_ID, PRESSURE_WASHING_PARTS } from '@/lib/plan/composite-trades';
import { t, type DictKey, type Lang } from '@/lib/i18n';
import { planNameEs } from '@/lib/plan/price-copy-es';
import type { ProfileCoverage } from '@/lib/check/profile-coverage';
import { profileCoverageAction } from '@/lib/check/profile-coverage-action';

export interface ProfileDefaults {
  business_name: string;
  categories: string[];
  zip: string;
  radius: number;
  alert_email: boolean;
  /** Saved extra ZIPs (Pro). Shown locked when the plan does not use them. */
  extra_zips?: string[];
  /** Saved keyword watches (Pro). */
  keywords?: string[];
}

const PRO = PLAN_LIMITS.pro;

/** Pads a list to n entries with blanks, so each input has a fixed slot. */
const slots = (list: string[] | undefined, n: number) => Array.from({ length: n }, (_, i) => list?.[i] ?? '');

/** One form for onboarding and settings. Fields are controlled so nothing resets after a failed submit. */
export function ProfileForm({
  action,
  categories,
  defaults,
  submitLabel,
  showAlertToggle = false,
  zipHint,
  tier = 'starter',
  upgradeHref = '/pricing',
  lang = 'en',
  initialCoverage = null,
}: {
  action: (prev: ProfileFormState, formData: FormData) => Promise<ProfileFormState>;
  categories: ChipCategory[];
  defaults: ProfileDefaults;
  submitLabel: string;
  showAlertToggle?: boolean;
  zipHint?: string;
  /** The plan whose limits apply now (lib/plan effectiveTier). Trial members get Solo (`starter`) limits. */
  tier?: Tier;
  /** Where the "see Pro" link goes: the billing section in settings, /pricing elsewhere. */
  upgradeHref?: string;
  /**
   * The member's language (round 18 ES). 'es' prints every label, hint and button from the dictionary and sends ui_lang 'es' with the
   * form, so the save's answers are Spanish too. English (the default) is the form as it always was. Trade labels come in `categories`.
   */
  lang?: Lang;
  /**
   * Round 24 FIX2 (review D2): the /check answer for the saved ZIP and trades, computed on the server (Settings), so it shows on the first
   * paint. As the member edits the ZIP or the trades the form asks profileCoverageAction (the same coverageFor answer, no database).
   */
  initialCoverage?: ProfileCoverage | null;
}) {
  const es = lang !== 'en';
  const w = (key: DictKey, en: string, vars?: Record<string, string | number>) => (es ? t(lang, key, { pro: planNameEs('pro'), ...vars }) : en);
  const [state, formAction, pending] = useActionState(action, {} as ProfileFormState);
  const [name, setName] = useState(defaults.business_name);
  // Coming-soon trades are never offered, so a saved one (from before the keys changed) drops out of the picks and the count.
  const comingSoon = new Set(categories.filter((c) => c.comingSoon).map((c) => c.id));
  const [picked, setPicked] = useState<string[]>(defaults.categories.filter((id) => !comingSoon.has(id)));
  const [zip, setZip] = useState(defaults.zip);
  const [radius, setRadius] = useState(defaults.radius);
  const [alertEmail, setAlertEmail] = useState(defaults.alert_email);
  const [extraZips, setExtraZips] = useState<string[]>(slots(defaults.extra_zips, PRO.extraAreas));
  const [keywords, setKeywords] = useState<string[]>(slots(defaults.keywords, PRO.keywords));
  const [coverage, setCoverage] = useState<ProfileCoverage | null>(initialCoverage);
  const pickedKey = picked.join(',');
  // The answer shown is the one for the ZIP and trades on screen now; a stale answer (an older ZIP or pick) is never shown.
  const shownCoverage = coverage && coverage.zip === zip && coverage.lines.map((l) => l.trade).join(',') === pickedKey ? coverage : null;
  useEffect(() => {
    if (!/^\d{5}$/.test(zip) || pickedKey === '') return;
    let live = true;
    const id = setTimeout(() => {
      profileCoverageAction(zip, pickedKey.split(','), lang)
        .then((c) => {
          if (live) setCoverage(c);
        })
        .catch(() => {});
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [zip, pickedKey, lang]);

  const isPro = tier === 'pro';
  const max = PLAN_LIMITS[tier].trades;
  const view = tradeLimitView(picked, max);
  /**
   * The composite "Pressure washing" chip (lib/plan/profile-categories.ts): it is selected when BOTH house cleaning and siding and
   * gutters are picked, turning it on adds both, turning it off removes both. Its own id is never in `picked`, so nothing is submitted
   * for it and no other code has to know about it. It takes two of the plan's trade slots, so it is only offered when two are free.
   */
  const pwOn = PRESSURE_WASHING_PARTS.every((id) => picked.includes(id));
  const togglePressureWashing = () =>
    setPicked((cur) => {
      if (PRESSURE_WASHING_PARTS.every((id) => cur.includes(id))) return cur.filter((id) => !PRESSURE_WASHING_PARTS.includes(id));
      const add = PRESSURE_WASHING_PARTS.filter((id) => !cur.includes(id));
      return cur.length + add.length > max ? cur : [...cur, ...add];
    });
  const label = (id: string) => categories.find((c) => c.id === id)?.label ?? id;
  const fe = state.fieldErrors ?? {};
  const groups = groupCategories(categories, lang);
  const rest = groups.filter((g) => g.key !== MARKETED_GROUP_KEY && g.key !== COMING_SOON_GROUP_KEY);
  // Round 24: the trades sign-up does not take yet, in their own group after "More trades", never pickable.
  const soon = groups.filter((g) => g.key === COMING_SOON_GROUP_KEY);
  // Open "More trades" when there is no marketed group at all (a deployment where none of them can be picked), or when a trade the
  // member already saved lives inside it: a saved pick must never be hidden from the person who saved it.
  const openRest = groups.every((g) => g.key !== MARKETED_GROUP_KEY) || rest.some((g) => g.items.some((c) => picked.includes(c.id)));

  /** One group's chips. A plain function, not a component, so the chips are not remounted on every keystroke in the form. */
  function renderGroup(g: (typeof groups)[number]) {
    return (
      <div key={g.key} role="group" aria-label={g.label ?? undefined}>
        {g.label ? <p className="mb-2 text-sm font-medium text-muted">{g.label}</p> : null}
        <div className="flex flex-wrap gap-2">
          {g.items.map((c) => {
            if (c.comingSoon) {
              return (
                <Chip key={c.id} selected={false} disabled aria-disabled="true">
                  {c.label}
                  {c.closed ? null : <span className="ml-2 text-xs font-normal">{c.noLiveSource ? w('pf.no_source', 'No live source yet') : w('pf.soon', 'Coming soon')}</span>}
                </Chip>
              );
            }
            if (c.id === PRESSURE_WASHING_ID) {
              return (
                <Chip
                  key={c.id}
                  selected={pwOn}
                  disabled={!pwOn && picked.length + PRESSURE_WASHING_PARTS.filter((id) => !picked.includes(id)).length > max}
                  aria-describedby="pf-pw-hint"
                  onClick={togglePressureWashing}
                >
                  {c.label}
                </Chip>
              );
            }
            const selected = picked.includes(c.id);
            return (
              <Chip key={c.id} selected={selected} disabled={!selected && view.full} onClick={() => setPicked((cur) => toggleTrade(cur, c.id, max))}>
                {c.label}
              </Chip>
            );
          })}
        </div>
        {g.items.some((c) => c.id === PRESSURE_WASHING_ID) ? (
          <p id="pf-pw-hint" className="mt-2 text-sm text-muted">
            {w(
              'pf.trade.pressure_washing_hint',
              'Counts as two trades: house cleaning, and siding and gutters. That is where pressure washing work shows up, in new-home and roof permits.',
            )}
          </p>
        ) : null}
      </div>
    );
  }
  const savedExtras = (defaults.extra_zips ?? []).filter(Boolean);
  const savedKeywords = (defaults.keywords ?? []).filter(Boolean);

  return (
    <form action={formAction} className="flex flex-col gap-7" noValidate>
      <Input
        label={w('pf.name', 'Business name')}
        name="business_name"
        autoComplete="organization"
        maxLength={80}
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={fe.business_name}
        placeholder={w('pf.name_ph', "Dale's Roofing")}
      />

      <fieldset aria-describedby="cat-hint" className="min-w-0">
        <legend className="text-sm font-semibold text-ink">{w('pf.what', 'What do you do?')}</legend>
        {es ? (
          <p id="cat-hint" className="mt-1 text-sm text-muted">
            {`${t(lang, 'pf.pick', { max })} `}
            <span className="font-mono tabular-nums">{`${picked.length}/${max}`}</span>
            {` ${t(lang, 'pf.chosen')}`}
            {isPro ? null : ` ${t(lang, 'pf.pro_covers', { pro: planNameEs('pro'), n: PRO.trades })}`}
          </p>
        ) : (
        <p id="cat-hint" className="mt-1 text-sm text-muted">
          Pick up to {max}. <span className="font-mono tabular-nums">{picked.length}/{max}</span> chosen.
          {isPro ? null : <> Pro covers up to {PRO.trades}.</>}
        </p>
        )}
        {view.unused.length > 0 ? (
          <div className="mt-3">
            {es ? (
              <Notice tone="warn">{t(lang, 'pf.unused', { max, used: view.used.map(label).join(', '), unused: view.unused.map(label).join(', ') })}</Notice>
            ) : (
            <Notice tone="warn">
              Your plan uses your first {max} trades: {view.used.map(label).join(', ')}. These stay saved but are not used:{' '}
              {view.unused.map(label).join(', ')}. To change trades, pick {max} or fewer.
            </Notice>
            )}
          </div>
        ) : null}
        {/* Round 23: the trades Holler is marketed for are the first group and are always open; the other 30-odd sit behind one
            disclosure, so the form opens on six chips instead of 37. <details> needs no JavaScript, so it works on a first paint and
            with the keyboard. A saved trade from the hidden part stays saved and stays counted; only the chips are folded away. */}
        <div className="mt-3 flex flex-col gap-5">
          {groups.filter((g) => g.key === MARKETED_GROUP_KEY).map(renderGroup)}
          {rest.length > 0 ? (
            <details className="rounded-card border border-line p-4" open={openRest}>
              <summary className="min-h-11 cursor-pointer text-sm font-semibold text-ink">{w('pf.more_trades', 'More trades')}</summary>
              <p className="mt-1 text-sm text-muted">
                {w('pf.more_trades_hint', 'Holler has records for these too, but fewer of them in the cities it covers today.')}
              </p>
              <div className="mt-3 flex flex-col gap-5">{rest.map(renderGroup)}</div>
            </details>
          ) : null}
          {soon.length > 0 ? (
            <details className="rounded-card border border-line p-4">
              <summary className="min-h-11 cursor-pointer text-sm font-semibold text-ink">{t(lang, 'group.coming-soon')}</summary>
              <p className="mt-1 text-sm text-muted">{t(lang, 'pf.coming_soon_hint')}</p>
              <div className="mt-3 flex flex-col gap-5">{soon.map((g) => renderGroup({ ...g, label: null }))}</div>
            </details>
          ) : null}
        </div>
        {picked.map((id) => (
          <input key={id} type="hidden" name="categories" value={id} />
        ))}
        {fe.categories ? (
          <p role="alert" className="mt-2 text-sm font-medium text-danger">
            {fe.categories}
          </p>
        ) : null}
      </fieldset>

      <div className="grid gap-7 sm:grid-cols-2">
        <Input
          label={w('pf.zip', 'ZIP code')}
          name="zip"
          inputMode="numeric"
          autoComplete="postal-code"
          pattern="[0-9]{5}"
          maxLength={5}
          required
          value={zip}
          onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
          error={fe.zip}
          hint={zipHint ?? w('pf.zip_hint', 'The center of where you work.')}
          placeholder="30303"
          className="font-mono tabular-nums"
        />
        <Slider
          label={w('pf.radius', 'How far will you go?')}
          name="radius"
          value={radius}
          onChange={setRadius}
          min={5}
          max={100}
          step={5}
          unit=" mi"
          hint={isPro ? w('pf.radius_hint_pro', 'Alerts only come from inside this radius of each ZIP.') : w('pf.radius_hint', 'Alerts only come from inside this radius.')}
        />
        {/* Round 24 FIX2 (review D2): the /check answer per picked trade at this ZIP. Inside this grid (its last cell, full width), not as a
            new child of the form, so the generated ids of the fields after it do not shift. */}
        {shownCoverage ? (
          <section aria-labelledby="pf-cov-h" className="rounded-card border border-line p-4 sm:col-span-2 sm:p-5" data-testid="trade-coverage">
            <h3 id="pf-cov-h" className="text-sm font-semibold text-ink">
              {t(lang, 'pf.cov.h', { place: shownCoverage.place })}
            </h3>
            <ul className="mt-2 flex flex-col gap-2">
              {shownCoverage.lines.map((l) => (
                <li key={l.trade} className="text-sm" data-answer={l.answer}>
                  <span className="font-semibold text-ink">{label(l.trade)}</span>
                  <span className="ml-2 rounded-chip bg-sand px-2 py-0.5 font-mono text-xs uppercase text-ink">{l.tag}</span>
                  <span className="mt-0.5 block text-muted">{l.text}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      {fe.radius ? (
        <p role="alert" className="-mt-4 text-sm font-medium text-danger">
          {fe.radius}
        </p>
      ) : null}

      <fieldset className="min-w-0 rounded-card border border-line p-4 sm:p-5" aria-describedby="pro-hint">
        <legend className="px-1 text-sm font-semibold text-ink">
          {es ? `${t(lang, 'pf.more_h')} ` : 'More areas and keyword watches '}<span className="ml-1 rounded-chip bg-sage px-2 py-0.5 font-mono text-xs font-medium uppercase text-brand-text">Pro</span>
        </legend>
        {isPro ? (
          es ? (
            <p id="pro-hint" className="text-sm text-muted">{t(lang, 'pf.pro_hint', { areas: PRO.extraAreas, kw: PRO.keywords })}</p>
          ) : (
          <p id="pro-hint" className="text-sm text-muted">
            Add up to {PRO.extraAreas} more ZIP codes. Watch up to {PRO.keywords} phrases. Leave any box blank to skip it.
          </p>
          )
        ) : (
          <div id="pro-hint" className="flex flex-col gap-2 text-sm text-muted">
            {es ? (
              <p>
                {t(lang, 'pf.pro_adds', { pro: planNameEs('pro'), areas: PRO.extraAreas, trades: PRO.trades, kw: PRO.keywords })}{' '}
                <Link href={upgradeHref} className="font-medium text-brand-text underline">
                  {t(lang, 'pf.see_pro', { pro: planNameEs('pro') })}
                </Link>
              </p>
            ) : (
            <p>
              Pro adds {PRO.extraAreas} more ZIP codes, up to {PRO.trades} trades and {PRO.keywords} keyword watches.{' '}
              <Link href={upgradeHref} className="font-medium text-brand-text underline">
                See Pro
              </Link>
            </p>
            )}
            {savedExtras.length || savedKeywords.length ? (
              <p>{w('pf.saved_pro', 'Your saved Pro settings stay here. They are not used on your current plan.')}</p>
            ) : null}
          </div>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {extraZips.map((z, i) => (
            <Input
              key={`zip-${i}`}
              label={es ? t(lang, 'pf.extra_zip', { n: i + 1 }) : `Extra ZIP code ${i + 1}`}
              name="extra_zip"
              inputMode="numeric"
              pattern="[0-9]{5}"
              maxLength={5}
              disabled={!isPro}
              value={z}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 5);
                setExtraZips((cur) => cur.map((x, j) => (j === i ? v : x)));
              }}
              error={i === 0 ? fe.extra_zips : undefined}
              placeholder="30060"
              className="font-mono tabular-nums"
            />
          ))}
        </div>

        <div className="mt-5">
          <p className="text-sm font-semibold text-ink">{w('pf.kw_h', 'Keyword watches')}</p>
          {es ? (
            <p className="mt-1 text-sm text-muted">{t(lang, 'pf.kw_hint', { min: KEYWORD_MIN_LENGTH, max: KEYWORD_MAX_LENGTH })}</p>
          ) : (
          <p className="mt-1 text-sm text-muted">
            Get any record in your areas that has this phrase in its title or summary, even outside your trades. Example: tree removal.
            Each one needs {KEYWORD_MIN_LENGTH} to {KEYWORD_MAX_LENGTH} characters. Use letters, numbers and spaces, plus &apos; &amp; - or /.
          </p>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {keywords.map((k, i) => (
              <Input
                key={`kw-${i}`}
                label={es ? t(lang, 'pf.kw', { n: i + 1 }) : `Keyword ${i + 1}`}
                name="keyword"
                minLength={KEYWORD_MIN_LENGTH}
                maxLength={KEYWORD_MAX_LENGTH}
                disabled={!isPro}
                value={k}
                onChange={(e) => {
                  const v = e.target.value;
                  setKeywords((cur) => cur.map((x, j) => (j === i ? v : x)));
                }}
                error={i === 0 ? fe.keywords : undefined}
              />
            ))}
          </div>
        </div>
      </fieldset>

      {showAlertToggle ? (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-base">
          <input
            type="checkbox"
            name="alert_email"
            checked={alertEmail}
            onChange={(e) => setAlertEmail(e.target.checked)}
            className="h-5 w-5 accent-brand"
          />
          <span>{w('pf.alert_email', 'Email me when something nearby matches')}</span>
        </label>
      ) : null}

      <div aria-live="polite">
        {/* Inside this box, not as a new child of the form: a new form child would shift the useId of every field after it. */}
        {es ? <input type="hidden" name="ui_lang" value={lang} /> : null}
        {state.error ? (
          <Notice tone="danger" role="alert">
            {state.error}
          </Notice>
        ) : null}
        {state.ok && state.message ? <Notice tone="success">{state.message}</Notice> : null}
      </div>

      {shownCoverage?.allWaitlist && shownCoverage.joinHref ? (
        <>
          {/* Every picked trade is waitlist here: a calm note (not an error), "Join the list" first, and saving is still allowed. */}
          <Notice tone="info" role="status">
            {t(lang, 'pf.cov.all_wait', { trades: shownCoverage.lines.map((l) => (es ? label(l.trade) : label(l.trade).toLowerCase())).join(', '), place: shownCoverage.place })}
          </Notice>
          <div className="flex flex-wrap items-center gap-3">
            <ButtonLink href={shownCoverage.joinHref} size="lg" className="max-sm:w-full">
              {t(lang, 'pf.cov.join', { place: shownCoverage.place })}
            </ButtonLink>
            <Button type="submit" variant="secondary" size="lg" disabled={pending} className="max-sm:w-full">
              {pending ? w('pf.saving', 'Saving...') : t(lang, 'pf.cov.continue')}
            </Button>
          </div>
        </>
      ) : (
        <Button type="submit" size="lg" disabled={pending} className="self-start max-sm:w-full">
          {pending ? w('pf.saving', 'Saving...') : submitLabel}
        </Button>
      )}
    </form>
  );
}
