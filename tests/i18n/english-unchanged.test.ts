/**
 * Round 17, unit ES: the English side of the dictionary is the English the code always had, and where a Spanish member's text is built
 * from the dictionary, the English path through the same code gives the old words. (The wide proof is that the existing English tests
 * all pass unchanged; this file pins the dictionary values that now sit next to code literals, so the two cannot drift.)
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import { t } from '@/lib/i18n';
import { OUTREACH_REMINDER, STORM_REMINDER, reminderFor } from '@/lib/outreach/templates';
import { OPPORTUNITY_CHIP } from '@/lib/signals/lead-rules';
import { chipLabel } from '@/lib/signals/lead-i18n';
import { KIND_LABEL, kindLabel, sourceLabel } from '@/components/signal-meta';
import { SOURCE_META } from '@/lib/signals/source-meta';
import { sourceLabelFromDict, sourceLabelLang } from '@/lib/signals/source-label-i18n';
import { SIGNAL_PHRASES } from '@/lib/seo/signal-types';
import { SIGNAL_TYPE_IDS } from '@/lib/signals/capabilities';
import { VERDICT_LABEL } from '@/lib/feedback/types';
import { CHECK_RADIUS_LABEL } from '@/lib/check/scope';
import { CADENCE_SHORT } from '@/lib/seo/cadence';
import { relativeTime } from '@/lib/time';
import { formatDistance, timeAgo } from '@/components/format';
import { watchList } from '@/lib/check/watch';
import { groupItems, type CheckItem } from '@/lib/check/group';
import { tradeGroups, tradeLabel } from '@/lib/check/trades';
import { CATEGORIES } from '@/lib/signals/categories';

describe('dictionary English equals the code literals next to it', () => {
  it('outreach reminders', () => {
    expect(en['outreach.reminder']).toBe(OUTREACH_REMINDER);
    expect(en['outreach.reminder_storm']).toBe(STORM_REMINDER);
    expect(reminderFor(false)).toBe(OUTREACH_REMINDER);
    expect(reminderFor(true)).toBe(STORM_REMINDER);
  });
  it('opportunity chips', () => {
    for (const [k, v] of Object.entries(OPPORTUNITY_CHIP)) {
      expect(en[`chip.${k}` as keyof typeof en]).toBe(v);
      expect(chipLabel(k as never, 'en')).toBe(v);
    }
  });
  it('kind badges', () => {
    for (const [k, v] of Object.entries(KIND_LABEL)) {
      expect(en[`kind.${k}` as keyof typeof en]).toBe(v);
      expect(kindLabel(k)).toBe(v);
    }
    expect(kindLabel('nonsense')).toBe('Signal');
    expect(en['kind.unknown']).toBe('Signal');
  });
  it('feedback buttons', () => {
    for (const [k, v] of Object.entries(VERDICT_LABEL)) expect(en[`card.feedback.${k}` as keyof typeof en]).toBe(v);
  });
  it('the watch phrases, the radius and the cadence line', () => {
    for (const id of SIGNAL_TYPE_IDS) expect(en[`chk.watch.${id}` as keyof typeof en], id).toBe(SIGNAL_PHRASES[id]);
    expect(en['chk.radius']).toBe(CHECK_RADIUS_LABEL);
    expect(en['cadence.short']).toBe(CADENCE_SHORT);
  });
  it('every public source label is rebuilt exactly from the English dictionary, and is Spanish in Spanish', () => {
    for (const [id, meta] of Object.entries(SOURCE_META)) {
      expect(sourceLabelFromDict(id, 'en'), id).toBe(meta.label);
      expect(sourceLabel(id), id).toBe(meta.label);
      const spanish = sourceLabelLang(id, 'es')!;
      expect(spanish, id).toBeTruthy();
      if (id !== 'holler-request') expect(spanish, id).not.toBe(meta.label);
      expect(spanish, id).not.toMatch(/open data|permits|requests|alerts|status|procurement|purchasing/i);
    }
    expect(sourceLabelLang('no-such-source', 'es')).toBeNull();
    expect(sourceLabel('no_such:source', 'es')).toBe('no such source');
  });
});

describe('time, distance and the check page words', () => {
  const now = Date.parse('2026-11-21T22:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it('English relative time is the English it always was', () => {
    expect(relativeTime(ago(30_000), now)).toBe('just now');
    expect(relativeTime(ago(5 * 60_000), now)).toBe('5 min ago');
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe('3 hr ago');
    expect(relativeTime(ago(2 * 86_400_000), now)).toBe('2 days ago');
    expect(relativeTime(new Date(now + 3 * 3_600_000).toISOString(), now)).toBe('in 3 hr');
    expect(timeAgo(ago(86_400_000), now)).toBe('1 day ago');
  });
  it('Spanish relative time: hace, en, singular and plural, then a short date', () => {
    expect(relativeTime(ago(30_000), now, 'app', 'es')).toBe('ahora mismo');
    expect(relativeTime(ago(5 * 60_000), now, 'app', 'es')).toBe('hace 5 min');
    expect(relativeTime(ago(3 * 3_600_000), now, 'app', 'es')).toBe('hace 3 h');
    expect(relativeTime(ago(86_400_000), now, 'app', 'es')).toBe('hace 1 día');
    expect(relativeTime(ago(2 * 86_400_000), now, 'app', 'es')).toBe('hace 2 días');
    expect(relativeTime(new Date(now + 3 * 3_600_000).toISOString(), now, 'app', 'es')).toBe('en 3 h');
    expect(relativeTime(ago(30 * 86_400_000), now, 'app', 'es')).toMatch(/^\d{1,2} (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)$/);
    expect(relativeTime(ago(40 * 3_600_000), now, 'email', 'es')).toBe('hace 40 h');
  });
  it('distance', () => {
    expect(formatDistance(0.4)).toBe('under 1 mi away');
    expect(formatDistance(12.6)).toBe('13 mi away');
    expect(formatDistance(0.4, 'es')).toBe('a menos de 1 mi');
    expect(formatDistance(12.6, 'es')).toBe('a 13 mi');
    expect(formatDistance(null, 'es')).toBeNull();
  });
  it('watch list: Spanish phrases for the same record types, same count', () => {
    const a = watchList('roofing', null);
    const b = watchList('roofing', null, undefined, 'es');
    expect(b).toHaveLength(a.length);
    expect(b.length).toBeGreaterThan(0);
    for (const line of b) expect(a).not.toContain(line);
  });
  it('check groups: Spanish titles in Spanish, English titles unchanged', () => {
    const item = (id: number, kind: string): CheckItem => ({ id, kind, source: 'x', title: 't', url: null, place: null, occurredAt: '2026-11-20T00:00:00Z', severity: 1 });
    const items = [item(1, 'report'), item(2, 'permit'), item(3, 'civic'), item(4, 'weirdkind')];
    expect(groupItems(items, now).map((g) => g.title).sort()).toEqual(['311, inspections and city records', 'Building permits', 'Other records', 'Weather and disasters'].sort());
    expect(groupItems(items, now, undefined, 'es').map((g) => g.title).sort()).toEqual([es['chk.group.civic'], es['chk.group.permit'], es['chk.group.other'], es['chk.group.weather']].sort());
  });
  it('trade lists: English is untouched; Spanish has the same ids, every one labelled', () => {
    const enGroups = tradeGroups();
    const esGroups = tradeGroups('es');
    expect(esGroups.map((g) => g.options.map((o) => o.id))).toEqual(enGroups.map((g) => g.options.map((o) => o.id)));
    for (const c of CATEGORIES) {
      expect(tradeLabel(c.id)).toBe(c.label);
      expect(tradeLabel(c.id, 'es')).toBe(es[`trade.${c.id}` as keyof typeof es]);
    }
    expect(esGroups.map((g) => g.label)).not.toEqual(enGroups.map((g) => g.label));
    expect(t('en', 'who.attention', { value: 'Pat' })).toBe('Attention: Pat');
  });
});
