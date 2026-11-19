import { useMemo, useState, type FormEvent } from 'react';
import { ApiCallError } from '../api/client';
import type { MeResponse, ProfileField, ProfileInput, TradeDto } from '../contract';
import { useApp } from '../state/AppContext';
import { cleanZip } from '../ui/format';
import { Button, ErrorState, Field, Loading, Notice } from '../ui/kit';

function splitList(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ProfileForm({
  submitLabel,
  busyLabel,
  onSave,
}: {
  submitLabel: string;
  busyLabel: string;
  onSave: (input: ProfileInput) => Promise<MeResponse>;
}) {
  const app = useApp();
  const profile = app.me?.profile ?? null;
  const limits = app.me?.limits ?? null;
  const cfg = app.config;
  const isPro = app.access.tier === 'pro' && app.access.state !== 'locked';

  const [businessName, setBusinessName] = useState(profile?.businessName ?? '');
  const [trades, setTrades] = useState<string[]>(profile?.trades ?? []);
  const [zip, setZip] = useState(profile?.zip ?? '');
  const [radius, setRadius] = useState<number>(profile?.radiusMi ?? cfg?.radius.default ?? 25);
  const [extraZips, setExtraZips] = useState((profile?.extraZips ?? []).join(', '));
  const [keywords, setKeywords] = useState((profile?.keywords ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<ProfileField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const groups = useMemo(() => {
    const out = new Map<string, TradeDto[]>();
    for (const t of cfg?.trades ?? []) {
      const g = t.group ?? '';
      out.set(g, [...(out.get(g) ?? []), t]);
    }
    return [...out.entries()];
  }, [cfg]);

  if (!cfg) {
    return app.configError ? <ErrorState message={app.configError} onRetry={() => void app.reloadConfig()} /> : <Loading />;
  }

  const maxTrades = limits?.trades ?? 5;
  const atLimit = trades.length >= maxTrades;

  function toggle(id: string) {
    setSaved(false);
    setTrades((t) => (t.includes(id) ? t.filter((x) => x !== id) : t.length >= maxTrades ? t : [...t, id]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    setSaved(false);
    const local: Partial<Record<ProfileField, string>> = {};
    if (!businessName.trim()) local.businessName = 'Enter your business name.';
    if (!trades.length) local.trades = 'Pick at least one trade.';
    if (!/^\d{5}$/.test(zip)) local.zip = 'Enter a 5-digit ZIP code.';
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }
    const input: ProfileInput = { businessName: businessName.trim(), trades, zip, radiusMi: radius };
    if (isPro) {
      input.extraZips = splitList(extraZips).map(cleanZip);
      input.keywords = splitList(keywords);
    }
    setBusy(true);
    try {
      const next = await onSave(input);
      app.setMe(next);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiCallError) {
        setErrors(err.fieldErrors);
        setFormError(Object.keys(err.fieldErrors).length ? 'Check the fields marked below.' : err.message);
      } else setFormError("We couldn't save that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack-lg" onSubmit={(e) => void submit(e)} noValidate>
      <Field
        id="business"
        label="Business name"
        autoComplete="organization"
        value={businessName}
        error={errors.businessName}
        onChange={(e) => { setSaved(false); setBusinessName(e.target.value); }}
      />

      <div className="field" role="group" aria-labelledby="trades-label">
        <p id="trades-label" className="group-label">Your trades</p>
        <span className="hint">
          Pick up to {maxTrades}. {trades.length} picked.
        </span>
        {groups.map(([group, items]) => (
          <div key={group || 'all'} className="stack" style={{ marginTop: 8 }}>
            {group ? <p className="small muted">{group}</p> : null}
            <div className="chip-grid">
              {items.map((t) => {
                const on = trades.includes(t.id);
                return (
                  <button key={t.id} type="button" className="chip" aria-pressed={on} disabled={!on && atLimit} onClick={() => toggle(t.id)}>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {errors.trades ? <span className="err">{errors.trades}</span> : null}
      </div>

      <Field
        id="zip"
        label="ZIP code you work from"
        inputMode="numeric"
        autoComplete="postal-code"
        maxLength={5}
        value={zip}
        error={errors.zip}
        onChange={(e) => { setSaved(false); setZip(cleanZip(e.target.value)); }}
      />

      <div className="field">
        <label htmlFor="radius">How far you travel: {radius} miles</label>
        <input
          id="radius"
          type="range"
          min={cfg.radius.min}
          max={cfg.radius.max}
          step={5}
          value={radius}
          onChange={(e) => { setSaved(false); setRadius(Number(e.target.value)); }}
          style={{ minHeight: 44, border: 0, padding: 0, background: 'none' }}
        />
        <span className="hint">
          From {cfg.radius.min} to {cfg.radius.max} miles.
        </span>
        {errors.radiusMi ? <span className="err">{errors.radiusMi}</span> : null}
      </div>

      {isPro ? (
        <>
          <Field
            id="extra-zips"
            label="Extra ZIP codes"
            inputMode="numeric"
            hint={`Pro: up to ${limits?.extraZips ?? 2}, separated by commas.`}
            value={extraZips}
            error={errors.extraZips}
            onChange={(e) => { setSaved(false); setExtraZips(e.target.value); }}
          />
          <Field
            id="keywords"
            label="Keyword watches"
            hint={`Pro: up to ${limits?.keywordWatches ?? 5}, separated by commas.`}
            value={keywords}
            error={errors.keywords}
            onChange={(e) => { setSaved(false); setKeywords(e.target.value); }}
          />
        </>
      ) : null}

      {formError ? <Notice tone="danger">{formError}</Notice> : null}
      {saved ? <Notice tone="success" role="status">Saved.</Notice> : null}
      <Button type="submit" full disabled={busy}>
        {busy ? busyLabel : submitLabel}
      </Button>
    </form>
  );
}
