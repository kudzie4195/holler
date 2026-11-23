/**
 * Round 17, unit ES: the member language preference (migration 0024) and the Settings control.
 * The code must keep working with 0024 NOT applied: the control is hidden, nothing is saved, nothing errors, everything is English.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { hasLanguageSetting, saveLanguage } from '@/lib/auth/language';
import { LanguageForm } from '@/components/language-form';
import { langOfProfile } from '@/lib/i18n';

/** A fake of the member's Supabase client: `.from('holler_profiles').update(patch).eq('user_id', id)`. */
function fakeClient(result: { error: { code?: string; message?: string } | null } | 'throw') {
  const calls: Array<{ table: string; patch: unknown; col: string; val: unknown }> = [];
  const client: any = {
    from(table: string) {
      return {
        update(patch: unknown) {
          return {
            eq: async (col: string, val: unknown) => {
              calls.push({ table, patch, col, val });
              if (result === 'throw') throw new Error('network');
              return result;
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

describe('saveLanguage', () => {
  it('writes only the language of the signed-in member, on holler_profiles', async () => {
    const f = fakeClient({ error: null });
    const r = await saveLanguage(f.client, 'u1', 'es');
    expect(r).toEqual({ ok: true, message: 'Idioma guardado.' });
    expect(f.calls).toEqual([{ table: 'holler_profiles', patch: { language: 'es' }, col: 'user_id', val: 'u1' }]);
    const back = await saveLanguage(fakeClient({ error: null }).client, 'u1', 'en');
    expect(back).toEqual({ ok: true, message: 'Language saved.' });
  });
  it('refuses anything but en or es, and writes nothing', async () => {
    for (const bad of ['fr', 'ES', '', null, undefined, 3, { language: 'es' }]) {
      const f = fakeClient({ error: null });
      const r = await saveLanguage(f.client, 'u1', bad);
      expect(r.ok).toBeUndefined();
      expect(r.error).toBeTruthy();
      expect(f.calls).toHaveLength(0);
    }
  });
  it('migration 0024 NOT applied (the column does not exist): saves nothing and shows no error', async () => {
    for (const error of [{ code: '42703', message: 'column "language" of relation "holler_profiles" does not exist' }, { code: 'PGRST204', message: "Could not find the 'language' column of 'holler_profiles' in the schema cache" }, { message: 'column holler_profiles.language does not exist' }]) {
      const r = await saveLanguage(fakeClient({ error }).client, 'u1', 'es');
      expect(r).toEqual({ ok: true, skipped: true });
      expect(r.error).toBeUndefined();
    }
  });
  it('any other failure is a short message in the language the member chose, never a thrown error', async () => {
    expect(await saveLanguage(fakeClient({ error: { code: '42501', message: 'permission denied' } }).client, 'u1', 'es')).toEqual({ error: 'No pudimos guardarlo. Intente de nuevo.' });
    expect(await saveLanguage(fakeClient('throw').client, 'u1', 'en')).toEqual({ error: "We couldn't save that. Try again." });
  });
});

describe('the control shows only when the profile row has a language', () => {
  it('hasLanguageSetting: the key is there (applied) or not (0024 not applied)', () => {
    expect(hasLanguageSetting({ business_name: 'X' })).toBe(false);
    expect(hasLanguageSetting({ business_name: 'X', language: 'en' })).toBe(true);
    expect(hasLanguageSetting({ business_name: 'X', language: null })).toBe(true);
    expect(hasLanguageSetting(null)).toBe(false);
  });
  it('the Settings page source renders the language section only behind hasLanguageSetting, and the main save does not write it', () => {
    const page = readFileSync('app/app/settings/page.tsx', 'utf8');
    expect(page).toMatch(/hasLanguageSetting\(profile\) \? \(/);
    const profileSave = readFileSync('lib/auth/profile.ts', 'utf8');
    expect(profileSave).not.toMatch(/language/);
    const actions = readFileSync('app/app/settings/actions.ts', 'utf8');
    // saveSettings never touches the language: it has its own action
    const saveSettingsBody = actions.slice(actions.indexOf('export async function saveSettings'), actions.indexOf('function targetingChanged'));
    expect(saveSettingsBody).not.toMatch(/language/i);
  });
  it('the select offers English and Español, each in its own language, with the saved one selected', () => {
    const noop = async () => ({});
    const es = renderToStaticMarkup(createElement(LanguageForm, { action: noop, current: 'es' }));
    expect(es).toContain('value="en"');
    expect(es).toContain('value="es"');
    expect(es).toMatch(/<option value="en"[^>]*>English<\/option>/);
    expect(es).toMatch(/<option value="es" selected=""[^>]*>Español<\/option>/);
    expect(es).toContain('Idioma');
    expect(es).toContain('Guardar idioma');
    const en = renderToStaticMarkup(createElement(LanguageForm, { action: noop, current: 'en' }));
    expect(en).toMatch(/<option value="en" selected=""[^>]*>English<\/option>/);
    expect(en).toContain('Language');
    expect(en).toContain('Save language');
    expect(en).toContain('Alert emails, alert cards and reply drafts use this language.');
  });
  it('a profile with no language key reads as English everywhere', () => {
    expect(langOfProfile({ business_name: 'X' } as any)).toBe('en');
  });
});

describe('migration 0024', () => {
  const sql = readFileSync('supabase/migrations/0024_holler_language.sql', 'utf8');
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  it('is idempotent: add column if not exists, a guarded constraint, a repeatable grant', () => {
    expect(code).toMatch(/alter table public\.holler_profiles add column if not exists language text not null default 'en'/);
    // final review r17 P2-10: the constraint is looked up on holler_profiles, not by name alone (as 0005 and 0022 do).
    expect(code).toMatch(/if not exists \(\s*select 1 from pg_constraint where conname = 'holler_profiles_language_check' and conrelid = 'public\.holler_profiles'::regclass\s*\)/);
    expect(code).toMatch(/check \(language in \('en', 'es'\)\)/);
    expect(code).toMatch(/grant insert \(language\), update \(language\) on table public\.holler_profiles to authenticated/);
  });
  it('touches only holler_profiles, drops nothing, and does not widen any other grant', () => {
    expect(code).not.toMatch(/\bdrop\b|\bdelete\b|\btruncate\b|\bupdate public\./i);
    const tables = [...code.matchAll(/public\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(['holler_profiles']));
    expect(code).not.toMatch(/grant (all|select)/i);
  });
});

describe('the Settings page, rendered with and without migration 0024', () => {
  async function render(profile: Record<string, unknown>) {
    vi.resetModules();
    vi.doMock('@/lib/auth/session', () => ({
      requireProfile: async () => ({ user: { id: 'u1', email: 'owner@pinos.test' }, profile }),
      getProfile: async () => profile,
      getUser: async () => ({ id: 'u1' }),
    }));
    vi.doMock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) }) }));
    vi.doMock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }));
    vi.doMock('@/app/app/settings/actions', () => ({ saveSettings: async () => ({}), saveLanguageSetting: async () => ({}), deleteAccount: async () => ({}) }));
    const { default: SettingsPage } = await import('@/app/app/settings/page');
    return renderToStaticMarkup(await SettingsPage());
  }
  const base = {
    user_id: 'u1', business_name: 'Techos Pinos', categories: ['roofing'], zip: '30060', city: 'Marietta', state: 'GA', lat: 33.95, lon: -84.55, radius_mi: 25,
    alert_email: true, subscription_status: 'trialing', trial_ends_at: '2099-01-01T00:00:00Z', email_verified_at: '2026-11-01T00:00:00Z', created_at: '2026-11-01T00:00:00Z',
    stripe_customer_id: null, stripe_subscription_id: null,
  };
  it('0024 applied: the language section is there, with the saved language selected', async () => {
    const html = await render({ ...base, language: 'es' });
    expect(html).toContain('id="language-h"');
    expect(html).toContain('name="language"');
    expect(html).toMatch(/<option value="es" selected=""[^>]*>Español<\/option>/);
  });
  it('0024 applied, English member: the section is in English', async () => {
    const html = await render({ ...base, language: 'en' });
    expect(html).toContain('id="language-h"');
    expect(html).toMatch(/<option value="en" selected=""[^>]*>English<\/option>/);
  });
  it('0024 NOT applied (no language key on the row): the control is hidden and the rest of the page is untouched', async () => {
    const html = await render({ ...base });
    expect(html).not.toContain('id="language-h"');
    expect(html).not.toContain('name="language"');
    expect(html).toContain('What you do and where');
    expect(html).toContain('Save changes');
  });
});
