import { damagePhraseOf } from './brief';

/**
 * Does an SPC wind remark REPORT damage to a thing? (round 18 unit LISTS, review 2). Pure and client-safe.
 *
 * The bar is zero false positives on tests/lists/rev2-wind.test.ts (the reviewer's 115-remark table, both as a measured gust and as an "UNK"
 * speed report): weather never claims damage. A real report this misses makes no list, which is the safe side. Single words ("down", "tree",
 * "roof", "blown", "power") never decide; the repo's own phrase detector (lib/signals/brief.ts damagePhraseOf, which knows negation and forecast
 * wording) does, sentence by sentence, and:
 *  - a sentence that says the damage is unknown, unassessed, pending or still to be reported never counts (UNASSESSED_RE);
 *  - the generic phrases "damage" and "destruction" count only next to a concrete thing (DAMAGED_THING_RE).
 * Used by the address lists (lib/lists/core.ts stormKindOf) and, since the round 18 integration, by the SPC adapter itself
 * (lib/signals/adapters/spc.ts): whether an UNK-speed or under-50 mph wind row is kept, its "Wind damage reported" title and its damage
 * severity. Cards and lists share one rule (tests/signals/spc-wind-title.test.ts runs the same table against the adapter).
 */
/** The detector's phrases that are wind damage (flooding, injuries and debris are not). */
const WIND_DAMAGE_PHRASES: ReadonlySet<string> = new Set(['trees down', 'power lines down', 'power poles down', 'roof damage', 'damage', 'destruction']);
/** A sentence that says the damage is not known yet: never a damage report. */
export const UNASSESSED_RE =
  /\b(?:unknown|unsure|uncertain|unconfirmed|undetermined|pending|awaiting|to\s+follow|not\s+yet|checking|survey(?:s|ed|ing)?|assess(?:ed|ing|ment)?)\b/i;
/** Wording the brief's detector does not carry, rewritten to wording it does (so its negation rules still apply). */
const toDetectorWords = (s: string) =>
  s
    .replace(/\bshingles?\s+(?:were\s+|was\s+)?(?:removed|missing|lost|ripped|peeled|gone)\b/gi, 'shingles torn')
    .replace(/\broofing\b/gi, 'roof')
    .replace(/\b(limbs?)\s+((?:\w+\s+)?)downed\b/gi, '$1 $2down');

/**
 * A concrete thing that can be damaged or brought down. The detector's generic phrases ("damage", "destruction") count only in a sentence
 * that names one ("Structural damage to mobile home", "Wind damage reported to a barn"); a bare "Damaging winds reported" or "Wind damage
 * reported." names nothing and makes no list. The specific phrases (trees down, power lines or poles down, roof damage) name their object.
 */
export const DAMAGED_THING_RE =
  /\b(?:homes?|houses?|residences?|apartments?|buildings?|structures?|structural|roofs?|shingles?|siding|gutters?|barns?|sheds?|garages?|carports?|outbuildings?|coops?|mobile\s+homes?|trailers?|businesses?|stores?|church(?:es)?|schools?|warehouses?|fences?|signs?|billboards?|windows?|awnings?|porch(?:es)?|decks?|canop(?:y|ies)|cars?|vehicles?|trucks?|trees?|limbs?|branches|power\s+(?:lines?|poles?)|utility\s+poles?|chimneys?|silos?|grain\s+bins?|towers?)\b/i;
const GENERIC_PHRASES: ReadonlySet<string> = new Set(['damage', 'destruction']);

/**
 * True when an SPC remark reports wind damage to a named thing: not negated, not a forecast, not "unknown", "possible", "pending" or "to
 * follow". Hedged, future, negated or object-less wording never makes a list; a real report this misses gives no list (the safe side).
 */
export function remarkNamesWindDamage(comments: string | null | undefined): boolean {
  return (comments ?? '')
    .split(/(?<=[.;!?])\s+|\n+/)
    .filter((s) => s.trim() && !UNASSESSED_RE.test(s))
    .some((s) => {
      const phrase = damagePhraseOf(toDetectorWords(s));
      if (phrase === null || !WIND_DAMAGE_PHRASES.has(phrase)) return false;
      return !GENERIC_PHRASES.has(phrase) || DAMAGED_THING_RE.test(s);
    });
}

