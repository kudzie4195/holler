// Round 17 integration (ES x STAGE): the stage-update line, subject, meta and push, built through lib/i18n.
// English is byte-for-byte what the STAGE unit shipped; Spanish passes the Spanish wording rules and says nothing about hiring or need.
import { describe, expect, it } from 'vitest';
import { en } from '@/lib/i18n/en';
import { es } from '@/lib/i18n/es';
import { spanishProblems } from '@/lib/i18n/rules';
import { allStageStrings, allStageUpdateStrings, stageLine, stageName, stageUpdateLine, stageUpdateMeta, stageUpdateSubject } from '@/lib/signals/stage';
import { buildNotification } from '@/lib/push/notify';
import { digestSubject } from '@/lib/email/templates';
import { pushNewMatches } from '@/lib/push/notify';
import { profileRow, UA } from '../mobile/fakes';
import { memDb } from '../mobile/memdb';

const AT = '2026-11-22T12:00:00Z';
const KEYS = Object.keys(en).filter((k) => k.startsWith('stage.') || k.startsWith('push.'));

describe('stage and push dictionary keys', () => {
  it('exist in both languages with the same placeholders, and no Spanish value is empty', () => {
    expect(KEYS.length).toBeGreaterThanOrEqual(22);
    for (const k of KEYS) {
      const e = (en as Record<string, string>)[k];
      const s = (es as Record<string, string>)[k];
      expect(s, k).toBeTruthy();
      expect((s.match(/\{\w+\}/g) ?? []).sort(), k).toEqual((e.match(/\{\w+\}/g) ?? []).sort());
    }
  });
});

describe('English is unchanged', () => {
  it('card line, update line, subject and meta equal the strings the STAGE unit shipped', () => {
    expect(stageLine('final_inspection', AT)).toBe('The public source lists this permit at final inspection (seen Nov 22, 2026). The building may be ready soon.');
    expect(stageLine('finaled')).toBe('The public source lists this permit as finished (on record). The building may be ready soon.');
    expect(stageLine('certificate_of_occupancy', AT, 'en')).toBe('The public source lists a certificate of occupancy (seen Nov 22, 2026). The building may open soon.');
    expect(stageUpdateLine('final_inspection', AT)).toBe('Stage update: final inspection, listed by the public source on Nov 22, 2026.');
    expect(stageUpdateSubject('finaled')).toBe('Update: finished on a permit near you');
    expect(stageUpdateMeta(AT)).toBe('Stage update, Nov 22, 2026');
    expect(stageName('certificate_of_occupancy')).toBe('certificate of occupancy');
    expect(digestSubject([{ kind: 'permit', title: 'x', permitStage: 'final_inspection', permitStageAt: AT, permitStageUpdate: true }], 1)).toBe('Update: final inspection on a permit near you');
  });
  it('push: titles and the stage body are the English strings', () => {
    const top = { signalId: 7, title: 'New construction permit in Norfolk', city: 'Norfolk', stage: 'final_inspection' };
    expect(buildNotification({ count: 1, top, updates: 1 }, null)).toMatchObject({ title: 'Update near Norfolk', body: 'Stage update, final inspection: New construction permit in Norfolk' });
    expect(buildNotification({ count: 3, top, updates: 3 }, null).title).toBe('3 updates near Norfolk');
    expect(buildNotification({ count: 3, top, updates: 1 }, null).title).toBe('3 alerts near Norfolk');
    expect(buildNotification({ count: 2, top: { ...top, stage: null }, updates: 0 }, null).title).toBe('2 new alerts near Norfolk');
  });
});

describe('Spanish stage text', () => {
  it('reads in Spanish with a Spanish date', () => {
    expect(stageLine('final_inspection', AT, 'es')).toBe('La fuente pública indica que este permiso está en inspección final (visto el 22 nov 2026). Es posible que el edificio esté listo pronto.');
    expect(stageLine('finaled', null, 'es')).toContain('(en el registro)');
    expect(stageUpdateLine('final_inspection', AT, 'es')).toBe('Actualización de etapa: inspección final, indicada por la fuente pública el 22 nov 2026.');
    expect(stageUpdateSubject('certificate_of_occupancy', 'es')).toBe('Actualización: certificado de ocupación en un permiso cerca de usted');
    expect(stageUpdateMeta(AT, 'es')).toBe('Actualización de etapa, 22 nov 2026');
    expect(stageLine('issued', AT, 'es')).toBeNull();
    expect(stageUpdateLine('issued', AT, 'es')).toBeNull();
  });
  it('every Spanish stage string passes the Spanish wording rules and promises nothing', () => {
    const all = [...allStageStrings('es'), ...allStageUpdateStrings('es'), ...KEYS.map((k) => (es as Record<string, string>)[k])];
    expect(allStageStrings('es')).toHaveLength(3);
    for (const s of all) {
      expect(spanishProblems(s), s).toEqual([]);
      expect(s, s).not.toMatch(/necesit|contrat|proveedor|ganar|garant|oficial|daño|cliente|lead/i);
    }
    for (const s of allStageStrings('es')) {
      expect(s).toMatch(/Es posible que/);
      expect(s).toMatch(/fuente pública/);
      expect(s.length).toBeLessThanOrEqual(150);
    }
  });
  it('the digest subject is Spanish for one update, updates only, and a mix', () => {
    const up = { kind: 'permit', title: 'x', permitStage: 'final_inspection', permitStageAt: AT, permitStageUpdate: true };
    expect(digestSubject([up], 1, 'es')).toBe('Actualización: inspección final en un permiso cerca de usted');
    expect(digestSubject([up, up], 2, 'es')).toBe('2 actualizaciones de permisos cerca de usted');
    expect(digestSubject([up, { kind: 'permit', title: 'y' }], 2, 'es')).toBe('2 novedades cerca de usted, 1 de ellas una actualización de etapa');
  });
});

describe('Spanish push', () => {
  const top = { signalId: 7, title: 'New construction permit in Norfolk', city: 'Norfolk', stage: 'final_inspection', source: 'socrata-norfolk-permits' };
  it('a stage update push says Actualización, the stage and a Spanish title, never "new"', () => {
    const n = buildNotification({ count: 1, top, updates: 1 }, null, 'es');
    expect(n.title).toBe('Actualización cerca de Norfolk');
    expect(n.body).toMatch(/^Actualización de etapa, inspección final: /);
    expect(n.body).not.toMatch(/New construction|permit in/);
    expect(spanishProblems(n.title + ' ' + n.body)).toEqual([]);
    expect(buildNotification({ count: 4, top, updates: 4 }, 'Atlanta', 'es').title).toBe('4 actualizaciones cerca de Norfolk');
    expect(buildNotification({ count: 4, top: { ...top, city: null }, updates: 1 }, null, 'es').title).toBe('4 alertas para usted');
  });
  it('an ordinary push for a Spanish member is Spanish too, and an English member is unchanged', () => {
    expect(buildNotification({ count: 1, top: { signalId: 1, title: 'x', city: 'Smyrna' } }, null, 'es').title).toBe('Nueva alerta cerca de Smyrna');
    expect(buildNotification({ count: 2, top: { signalId: 1, title: 'x', city: null } }, null, 'es').title).toBe('2 alertas nuevas para usted');
    expect(buildNotification({ count: 2, top: { signalId: 1, title: 'x', city: null } }, null, 'en').title).toBe('2 new alerts for you');
  });
});

describe('pushNewMatches reads the member language on its own (migration 0024)', () => {
  const NOW = new Date('2026-11-22T12:00:00Z');
  const DAY = 86_400_000;
  const setup = (profile: Record<string, unknown>) =>
    memDb({
      holler_profiles: [profile],
      holler_push_tokens: [{ id: 'a1', user_id: UA, token: 'tA1', platform: 'ios', disabled_at: null }],
      holler_signals: [{ id: 9, title: 'New construction permit in Norfolk', city: 'Norfolk', source: 'socrata-norfolk-permits', kind: 'permit', summary: 'New Construction | 100 EXAMPLE AVE', categories: ['general-contractor'], expires_at: null, occurred_at: '2026-10-10T00:00:00Z', permitStage: 'finaled', permitStageAt: NOW.toISOString(), permitStageUpdate: 'true' }],
      holler_matches: [{ id: 1, user_id: UA, signal_id: 9, status: 'new', notified: false, pushed_at: null, created_at: new Date(NOW.getTime() - 30 * DAY).toISOString() }],
    });
  const run = async (m: ReturnType<typeof setup>, db: unknown = m.db) => {
    const sent: Array<{ title: string; body: string }> = [];
    const r = await pushNewMatches(db as never, { now: NOW, configured: true, send: async (x: { title: string; body: string }) => (sent.push({ title: x.title, body: x.body }), { ok: true as const }) });
    return { r, sent };
  };

  it('an es member gets the stage update push in Spanish', async () => {
    const { r, sent } = await run(setup(profileRow(UA, { language: 'es' })));
    expect(r.matches_pushed).toBe(1);
    expect(sent).toEqual([{ title: 'Actualización cerca de Norfolk', body: 'Actualización de etapa, obra terminada: Permiso de construcción nueva en Norfolk' }]);
  });
  it('an en member, and a profile with no language key (0024 not applied), get the English push unchanged', async () => {
    const a = await run(setup(profileRow(UA, { language: 'en' })));
    expect(a.sent).toEqual([{ title: 'Update near Norfolk', body: 'Stage update, finished: New construction permit in Norfolk' }]);
    const b = await run(setup(profileRow(UA)));
    expect(b.sent).toEqual(a.sent);
  });
  it('when the language read fails (the column does not exist) the push still goes out, in English', async () => {
    const m = setup(profileRow(UA, { language: 'es' }));
    const real = m.db;
    const db = {
      from(table: string) {
        const b = (real as unknown as { from: (t: string) => Record<string, (...a: unknown[]) => unknown> }).from(table);
        if (table !== 'holler_profiles') return b;
        return {
          ...b,
          select: (cols: string, ...rest: unknown[]) =>
            /\blanguage\b/.test(cols) ? { in: () => Promise.resolve({ data: null, error: { code: '42703', message: 'column holler_profiles.language does not exist' } }) } : b.select(cols, ...rest),
          update: (...a: unknown[]) => b.update(...a),
        };
      },
    };
    const { r, sent } = await run(m, db);
    expect(r.members_pushed).toBe(1);
    expect(sent).toEqual([{ title: 'Update near Norfolk', body: 'Stage update, finished: New construction permit in Norfolk' }]);
  });
});
