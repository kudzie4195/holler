/**
 * Round 17, unit ES: reply drafts use the member's language. The model is a mock (no gateway call, no network); English input is
 * byte-identical to what it was before the language existed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { generateDraft, instructionsFor, promptFor, BANNED_WORDS } from '@/lib/ai/draft';
import { AiFakeDb, NOW } from '../ai/fake-db';
import { es } from '@/lib/i18n/es';

const INPUT = { businessName: 'Techos Pinos', categories: ['roofing', 'tree-service'], title: 'Busco quien arregle una gotera', summary: 'Después de la tormenta', city: 'Marietta' };
const GOOD_ES = 'Hola, vi su publicación. Soy de Techos Pinos y con gusto reviso la gotera esta semana, solo responda aquí.';

function model(text: string) {
  const calls: Array<{ prompt: unknown }> = [];
  const m = new MockLanguageModelV4({
    doGenerate: async (opts) => {
      calls.push(opts as never);
      return {
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: { inputTokens: { total: 300, noCache: 300, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 50, text: 50, reasoning: undefined } },
        warnings: [],
      };
    },
  });
  return { m, calls };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const promptText = (call: { prompt: unknown }) => JSON.stringify(call.prompt);

describe('draft instructions and prompt', () => {
  it('English instructions and prompt are exactly the English ones (byte for byte)', () => {
    const en = instructionsFor('en');
    expect(en).toBe(
      `You write short reply drafts for a local business owner who found a public post where someone asked for a recommendation.\nRules: 2 to 3 sentences. Neighborly, plain, helpful. Mention the business name exactly once. No links, no phone numbers, no emojis, no em dashes. Do not use hype words (${BANNED_WORDS.join(', ')}). Do not invent prices, licenses, reviews or years in business. Answer what the person asked, then offer to help. Output only the reply text.`,
    );
    expect(promptFor({ ...INPUT, categories: ['roofing'] }, 'en')).toBe(
      'Business: Techos Pinos\nWhat the business does: roofing\nBusiness area: Marietta\nPost title: Busco quien arregle una gotera\nPost text: Después de la tormenta',
    );
    expect(promptFor({ businessName: 'X', categories: [], title: 't' }, 'en')).toBe('Business: X\nWhat the business does: local services\nPost title: t');
  });
  it('Spanish instructions are the dictionary template with the Spanish hype list, and ask for usted', () => {
    const i = instructionsFor('es');
    expect(i).toContain('usted');
    expect(i).toContain('garantizado');
    expect(i).not.toMatch(/\{banned\}/);
    expect(es['draft.instructions']).toContain('{banned}');
  });
  it('Spanish prompt labels are Spanish and trade ids become Spanish trade names', () => {
    const p = promptFor(INPUT, 'es');
    expect(p).toContain('Negocio: Techos Pinos');
    expect(p).toContain('Lo que hace el negocio: Techos, Servicio de árboles');
    expect(p).toContain('Zona del negocio: Marietta');
    expect(p).toContain('Título de la publicación:');
    expect(p).toContain('Texto de la publicación:');
  });
});

describe('generateDraft in Spanish', () => {
  it('sends the Spanish instructions and prompt, and keeps a clean Spanish answer', async () => {
    const db = new AiFakeDb();
    const { m, calls } = model(GOOD_ES);
    const r = await generateDraft({ ...INPUT, lang: 'es' }, { db: db as never, model: m, now: NOW, env: {} });
    expect(r).toEqual({ ok: true, draft: GOOD_ES, source: 'ai' });
    expect(calls).toHaveLength(1);
    const sent = promptText(calls[0]);
    expect(sent).toContain('Usted escribe borradores');
    expect(sent).toContain('Negocio: Techos Pinos');
  });
  it('a model answer with "garantizado" or a link falls back to the Spanish template, never English', async () => {
    for (const bad of ['Hola, soy Techos Pinos y le garantizamos el mejor precio de la zona.', 'Hola, Techos Pinos le ayuda, vea https://techos.example hoy mismo.', 'Hola, un cliente potencial. Techos Pinos le ayuda.']) {
      const { m } = model(bad);
      const r = await generateDraft({ ...INPUT, lang: 'es' }, { db: new AiFakeDb() as never, model: m, now: NOW, env: {} });
      expect(r).toMatchObject({ ok: true, source: 'fallback' });
      if (r.ok) {
        expect(r.draft).toMatch(/^Hola, vi su publicación/);
        expect(r.draft).toContain('Techos Pinos');
      }
    }
  });
  it('an answer that names the business twice falls back (same rule as English)', async () => {
    const { m } = model('Hola, Techos Pinos aquí. Techos Pinos le ayuda con gusto.');
    const r = await generateDraft({ ...INPUT, lang: 'es' }, { db: new AiFakeDb() as never, model: m, now: NOW, env: {} });
    expect(r).toMatchObject({ ok: true, source: 'fallback' });
  });
  it('with no gateway auth the Spanish template is used and nothing is sent', async () => {
    const r = await generateDraft({ ...INPUT, lang: 'es' }, { db: new AiFakeDb() as never, now: NOW, env: {} });
    expect(r).toMatchObject({ ok: true, source: 'fallback' });
    if (r.ok) expect(r.draft).toMatch(/Techos Pinos/);
  });
  it('without a language the draft is English, as it always was', async () => {
    const { m, calls } = model('Hi, sorry about the leak. Techos Pinos can take a look this week if you still need a hand.');
    const r = await generateDraft(INPUT, { db: new AiFakeDb() as never, model: m, now: NOW, env: {} });
    expect(r).toMatchObject({ ok: true, source: 'ai' });
    expect(promptText(calls[0])).toContain('You write short reply drafts');
  });
});
