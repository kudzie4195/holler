'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { Button } from './button';
import { Chip } from './chip';
import { Input } from './input';
import { Notice } from './notice';
import { Slider } from './slider';
import type { ProfileFormState } from '@/lib/auth/profile-types';
import { KEYWORD_MAX_LENGTH, KEYWORD_MIN_LENGTH, PLAN_LIMITS, type Tier } from '@/lib/plan/limits';
import { groupCategories, toggleTrade, tradeLimitView, type ChipCategory } from './profile-form-groups';

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
}) {
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

  const isPro = tier === 'pro';
  const max = PLAN_LIMITS[tier].trades;
  const view = tradeLimitView(picked, max);
  const label = (id: string) => categories.find((c) => c.id === id)?.label ?? id;
  const fe = state.fieldErrors ?? {};
  const groups = groupCategories(categories);
  const savedExtras = (defaults.extra_zips ?? []).filter(Boolean);
  const savedKeywords = (defaults.keywords ?? []).filter(Boolean);

  return (
    <form action={formAction} className="flex flex-col gap-7" noValidate>
      <Input
        label="Business name"
        name="business_name"
        autoComplete="organization"
        maxLength={80}
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={fe.business_name}
        placeholder="Dale's Roofing"
      />

      <fieldset aria-describedby="cat-hint" className="min-w-0">
        <legend className="text-sm font-semibold text-ink">What do you do?</legend>
        <p id="cat-hint" className="mt-1 text-sm text-muted">
          Pick up to {max}. <span className="font-mono tabular-nums">{picked.length}/{max}</span> chosen.
          {isPro ? null : <> Pro covers up to {PRO.trades}.</>}
        </p>
        {view.unused.length > 0 ? (
          <div className="mt-3">
            <Notice tone="warn">
              Your plan uses your first {max} trades: {view.used.map(label).join(', ')}. These stay saved but are not used:{' '}
              {view.unused.map(label).join(', ')}. To change trades, pick {max} or fewer.
            </Notice>
          </div>
        ) : null}
        <div className="mt-3 flex flex-col gap-5">
          {groups.map((g) => (
            <div key={g.key} role="group" aria-label={g.label ?? undefined}>
              {g.label ? <p className="mb-2 text-sm font-medium text-muted">{g.label}</p> : null}
              <div className="flex flex-wrap gap-2">
                {g.items.map((c) => {
                  if (c.comingSoon) {
                    return (
                      <Chip key={c.id} selected={false} disabled aria-disabled="true">
                        {c.label}
                        <span className="ml-2 text-xs font-normal">Coming soon</span>
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
            </div>
          ))}
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
          label="ZIP code"
          name="zip"
          inputMode="numeric"
          autoComplete="postal-code"
          pattern="[0-9]{5}"
          maxLength={5}
          required
          value={zip}
          onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
          error={fe.zip}
          hint={zipHint ?? 'The center of where you work.'}
          placeholder="30303"
          className="font-mono tabular-nums"
        />
        <Slider
          label="How far will you go?"
          name="radius"
          value={radius}
          onChange={setRadius}
          min={5}
          max={100}
          step={5}
          unit=" mi"
          hint={isPro ? 'Alerts only come from inside this radius of each ZIP.' : 'Alerts only come from inside this radius.'}
        />
      </div>
      {fe.radius ? (
        <p role="alert" className="-mt-4 text-sm font-medium text-danger">
          {fe.radius}
        </p>
      ) : null}

      <fieldset className="min-w-0 rounded-card border border-line p-4 sm:p-5" aria-describedby="pro-hint">
        <legend className="px-1 text-sm font-semibold text-ink">
          More areas and keyword watches <span className="ml-1 rounded-chip bg-sage px-2 py-0.5 font-mono text-xs font-medium uppercase text-brand-text">Pro</span>
        </legend>
        {isPro ? (
          <p id="pro-hint" className="text-sm text-muted">
            Add up to {PRO.extraAreas} more ZIP codes. Watch up to {PRO.keywords} phrases. Leave any box blank to skip it.
          </p>
        ) : (
          <div id="pro-hint" className="flex flex-col gap-2 text-sm text-muted">
            <p>
              Pro adds {PRO.extraAreas} more ZIP codes, up to {PRO.trades} trades and {PRO.keywords} keyword watches.{' '}
              <Link href={upgradeHref} className="font-medium text-brand-text underline">
                See Pro
              </Link>
            </p>
            {savedExtras.length || savedKeywords.length ? (
              <p>Your saved Pro settings stay here. They are not used on your current plan.</p>
            ) : null}
          </div>
        )}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {extraZips.map((z, i) => (
            <Input
              key={`zip-${i}`}
              label={`Extra ZIP code ${i + 1}`}
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
          <p className="text-sm font-semibold text-ink">Keyword watches</p>
          <p className="mt-1 text-sm text-muted">
            Get any record in your areas that has this phrase in its title or summary, even outside your trades. Example: tree removal.
            Each one needs {KEYWORD_MIN_LENGTH} to {KEYWORD_MAX_LENGTH} characters. Use letters, numbers and spaces, plus &apos; &amp; - or /.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {keywords.map((k, i) => (
              <Input
                key={`kw-${i}`}
                label={`Keyword ${i + 1}`}
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
          <span>Email me when something nearby matches</span>
        </label>
      ) : null}

      <div aria-live="polite">
        {state.error ? (
          <Notice tone="danger" role="alert">
            {state.error}
          </Notice>
        ) : null}
        {state.ok && state.message ? <Notice tone="success">{state.message}</Notice> : null}
      </div>

      <Button type="submit" size="lg" disabled={pending} className="self-start max-sm:w-full">
        {pending ? 'Saving...' : submitLabel}
      </Button>
    </form>
  );
}
