/**
 * The short label a record gets on the home page map ("ROOF PERMIT", "TREE EMERGENCY"). Pure.
 *
 * Made only from the record's own title, in the shapes the adapters write (lib/signals/adapters/*, lib/signals/mapping/permit.ts):
 *   "Roof permit in Chicago"                      -> "Roof permit"
 *   "HVAC and electrical permit in Mecklenburg"   -> "HVAC permit"      (first kind when the whole list is too long)
 *   "New construction permit in Chicago"          -> "New construction" (the word "permit" dropped when the kind alone fills it)
 *   "311 request in Chicago: Tree Emergency"      -> "Tree Emergency"
 *   "311 request in Chicago: Graffiti Removal Request" -> "Graffiti Removal" (a trailing "Request", "Complaint" or "Reports" dropped)
 *   "311 request in Chicago: Rodent Baiting/Rat Complaint" -> "Rodent Baiting" (first part of a "/" list when the whole is too long)
 *   "Code violation in Chicago: REPAIR PORCH SYSTEM" -> "Repair porch" (all-caps source text in sentence case, cut at a word)
 *   "1.00 inch hail reported near Tulsa, OK"      -> "1.00 in hail"
 *   "Severe Thunderstorm Warning: Tulsa County"   -> "Severe T-storm"
 * Rule, in order: take the part that names what happened (the detail after the colon for 311, code and other "X in City: detail"
 * titles; the kind before "permit in"; the text before "reported near" or before the colon for weather), shorten a few long words
 * (thunderstorm, inch), and if it is still longer than LABEL_MAX characters, keep the longest run of whole words from the start
 * that fits (never ending on "and", "of" or a slash). A single word longer than LABEL_MAX is cut. Never empty: a title with no
 * usable part gives "RECORD".
 */

export const LABEL_MAX = 16;

const ACRONYMS = new Set(['HVAC', 'NYC', 'NWS', 'NOAA', 'FEMA', 'USGS', 'FAA', 'US', 'ADA', 'EV', 'AC']);

/** "REPAIR PORCH SYSTEM" -> "Repair porch system". Mixed-case text is kept as it is. Known acronyms stay upper case. */
export function sentenceCase(s: string): string {
  if (s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s;
  const words = s.toLowerCase().split(' ');
  return words
    .map((w, i) => {
      if (ACRONYMS.has(w.toUpperCase())) return w.toUpperCase();
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    })
    .join(' ');
}

const TRAILING_GENERIC = /\s+(requests?|complaints?|reports?)$/i;
const CONNECTOR_END = /(\s+(and|or|of|the|at|in|on|for|to|with|&)|[\s/,;:+-]+)$/i;

function tidy(s: string): string {
  return s
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:/-]+|[\s,;:/-]+$/g, '')
    .trim();
}

function abbreviate(s: string): string {
  return s
    .replace(/\bthunderstorms?\b/gi, (m) => (m[0] === 'T' ? 'T-storm' : 't-storm'))
    .replace(/\binch(es)?\b/gi, 'in');
}

/** Longest run of whole words from the start that fits in max characters. */
export function fitWords(s: string, max = LABEL_MAX): string {
  if (s.length <= max) return s;
  const words = s.split(' ');
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > max) break;
    out = next;
  }
  while (out && CONNECTOR_END.test(out)) out = out.replace(CONNECTOR_END, '');
  if (!out) out = words[0].slice(0, max);
  return out.replace(/[\s/,;:+-]+$/, '');
}

/** First part of a list ("A / B", "A/B", "A and B") when the whole does not fit. */
function firstPart(s: string, max: number): string {
  if (s.length <= max) return s;
  for (const sep of [' / ', '/', ', ', ' and ']) {
    const head = s.split(sep)[0];
    if (head !== s && head.trim()) return head.trim();
  }
  return s;
}

/** The phrase in the record's own case, at most LABEL_MAX characters. */
export function labelPhrase(title: string): string {
  const t = tidy(String(title ?? ''));
  if (!t) return 'Record';

  // Permits: "<kinds> permit in <place>" or "Permit in <place>".
  const permit = /^(.*?)\s*\bpermit in\b/i.exec(t);
  if (permit && !/:/.test(t.slice(0, permit[0].length))) {
    const kinds = tidy(permit[1]);
    if (!kinds) return 'Permit';
    const full = `${kinds} permit`;
    if (full.length <= LABEL_MAX) return full;
    const first = firstPart(kinds, 0);
    const one = `${first} permit`;
    if (one.length <= LABEL_MAX) return one;
    return fitWords(sentenceCase(first));
  }

  // Weather reports: "<what> reported near <place>".
  const reported = /^(.*?)\s+reported near\b/i.exec(t);
  if (reported && tidy(reported[1])) return fitWords(abbreviate(tidy(reported[1])));

  // "<Type> in <place>: <detail>" (311, code violations, business licenses, events, contracts).
  const detail = /^[^:]*?\bin\b[^:]*:\s*(.+)$/i.exec(t);
  let phrase = detail ? tidy(detail[1]) : '';
  if (!phrase) {
    // Weather alerts: "<Event>: <area>", or anything else: the text before a colon or before " in ".
    phrase = tidy(t.split(':')[0].split(/\s+in\s+/i)[0]);
  }
  phrase = sentenceCase(abbreviate(phrase));
  phrase = firstPart(phrase, LABEL_MAX);
  if (phrase.length > LABEL_MAX && TRAILING_GENERIC.test(phrase)) phrase = phrase.replace(TRAILING_GENERIC, '');
  // A trailing generic word is dropped whenever the rest still says something ("Graffiti Removal Request" -> "Graffiti Removal").
  else if (TRAILING_GENERIC.test(phrase) && phrase.replace(TRAILING_GENERIC, '').split(' ').length >= 2) phrase = phrase.replace(TRAILING_GENERIC, '');
  phrase = fitWords(phrase);
  return phrase || 'Record';
}

/** The map label: the phrase in capitals, at most LABEL_MAX characters. */
export function mapLabel(title: string): string {
  return labelPhrase(title).toUpperCase();
}
