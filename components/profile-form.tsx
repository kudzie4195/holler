'use client';

import { useActionState, useState } from 'react';
import { Button } from './button';
import { Chip } from './chip';
import { Input } from './input';
import { Notice } from './notice';
import { Slider } from './slider';
import type { ProfileFormState } from '@/lib/auth/profile-types';

export interface ProfileDefaults {
  business_name: string;
  categories: string[];
  zip: string;
  radius: number;
  alert_email: boolean;
}

const MAX_CATEGORIES = 5;

/** One form for onboarding and settings. Fields are controlled so nothing resets after a failed submit. */
export function ProfileForm({
  action,
  categories,
  defaults,
  submitLabel,
  showAlertToggle = false,
  zipHint,
}: {
  action: (prev: ProfileFormState, formData: FormData) => Promise<ProfileFormState>;
  categories: { id: string; label: string }[];
  defaults: ProfileDefaults;
  submitLabel: string;
  showAlertToggle?: boolean;
  zipHint?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {} as ProfileFormState);
  const [name, setName] = useState(defaults.business_name);
  const [picked, setPicked] = useState<string[]>(defaults.categories);
  const [zip, setZip] = useState(defaults.zip);
  const [radius, setRadius] = useState(defaults.radius);
  const [alertEmail, setAlertEmail] = useState(defaults.alert_email);

  const fe = state.fieldErrors ?? {};
  const full = picked.length >= MAX_CATEGORIES;

  function toggle(id: string) {
    setPicked((cur) => (cur.includes(id) ? cur.filter((c) => c !== id) : cur.length >= MAX_CATEGORIES ? cur : [...cur, id]));
  }

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
          Pick up to {MAX_CATEGORIES}. <span className="font-mono tabular-nums">{picked.length}/{MAX_CATEGORIES}</span> chosen.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {categories.map((c) => {
            const selected = picked.includes(c.id);
            return (
              <Chip key={c.id} selected={selected} disabled={!selected && full} onClick={() => toggle(c.id)}>
                {c.label}
              </Chip>
            );
          })}
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
          hint="Alerts only come from inside this radius."
        />
      </div>
      {fe.radius ? (
        <p role="alert" className="-mt-4 text-sm font-medium text-danger">
          {fe.radius}
        </p>
      ) : null}

      {showAlertToggle ? (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-base">
          <input
            type="checkbox"
            name="alert_email"
            checked={alertEmail}
            onChange={(e) => setAlertEmail(e.target.checked)}
            className="h-5 w-5 accent-[var(--color-accent)]"
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
