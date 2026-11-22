/**
 * Spanish wording rules (round 17, unit ES), the Spanish side of the banned-words approach in tests/signals/ship-banned-words.test.ts.
 * Pure data and one checker; no imports, so server code, client code and tests can all use it.
 *
 * The rules, from the Holler wording rules:
 *  - no "garantizado" (or any form of garantizar / garantia): nothing is promised;
 *  - no "cliente potencial" and no "leads" (or "lead", "prospecto"): the word is never used;
 *  - weather never claims damage: a damage word ("dano", "danos", "danado") may appear only in a text that also says "no confirmado";
 *  - links and sources say "fuente publica", never "registro oficial" / "fuente oficial";
 *  - never "they need you" or "you will win" (le necesitan, lo necesitan, usted ganara, va a ganar);
 *  - no em dash;
 *  - usted, not tu: no tuteo forms.
 * Hype words are also listed for the Spanish reply-draft instructions and checker (lib/ai/fallback.ts).
 */

export interface SpanishRule {
  id: string;
  /** Matches text that breaks the rule. */
  re: RegExp;
}

// JavaScript's \b only knows ASCII letters, so "ganará" and "tú" have no word edge after the accent. These use letter look-arounds instead.
const B = '(?<!\\p{L})';
const E = '(?!\\p{L})';
const rx = (src: string) => new RegExp(src, 'iu');

export const ES_BANNED: readonly SpanishRule[] = [
  { id: 'garantizado', re: rx('garant') },
  { id: 'cliente-potencial', re: rx('clientes?\\s+potencial(es)?') },
  { id: 'lead', re: rx(`${B}leads?${E}`) },
  { id: 'prospecto', re: rx(`${B}prospectos?${E}`) },
  { id: 'registro-oficial', re: rx(`(registros?|fuentes?|récords?|records?|archivos?)\\s+oficial(es)?${E}`) },
  { id: 'they-need-you', re: rx(`${B}(le|lo|la|les|los|las)\\s+necesit(a|an)${E}|${B}necesitan\\s+(sus servicios|a usted)${E}`) },
  { id: 'you-will-win', re: rx(`${B}(ganar[áa]|va a ganar|se ganar[áa])${E}`) },
  { id: 'em-dash', re: rx('—') },
  { id: 'tuteo', re: rx(`${B}(tú|tienes|puedes|quieres|necesitas|eres|estás|contáctanos|llámanos|ponte|mira|haz)${E}`) },
];

/** Words that may appear only next to "no confirmado" (weather and storm cards never claim damage). */
export const ES_DAMAGE = /(?<!\p{L})da(ñ|n)(o|os|ado|ada|ados|adas)(?!\p{L})/iu;
export const ES_NOT_CONFIRMED = /no confirmad[oa]s?/i;

/** Hype words the Spanish reply drafts must not use (same idea as BANNED_WORDS in lib/ai/fallback.ts for English). */
export const ES_BANNED_DRAFT_WORDS: readonly string[] = [
  'desbloquee', 'potencie', 'revolucion', 'aproveche', 'sin esfuerzo', 'de vanguardia', 'innovador', 'transforme', 'lo mejor del mercado',
  'garantizado', 'garantizamos', 'garantía', 'cliente potencial', 'leads', 'lead',
];

/** Rule ids a Spanish text breaks. Empty means clean. `allowDamageWords` is for phrase fragments such as "árboles caídos" that sit inside a sentence with "no confirmado". */
export function spanishProblems(text: string, opts: { allowDamageWords?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const r of ES_BANNED) if (r.re.test(text)) out.push(r.id);
  if (!opts.allowDamageWords && ES_DAMAGE.test(text) && !ES_NOT_CONFIRMED.test(text)) out.push('damage-without-not-confirmed');
  return out;
}
