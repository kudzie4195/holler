// Round 3 review P1-1: every bypass the reviewer found in the description filter, as a table. The filtered text is no longer public
// (holler_signals.summary is null for requests), but businesses still see it, so nothing that can reach or identify the writer (or
// someone else) may pass. Before this change each input below came out unchanged or with the identifying part kept (review, RAN).
import { describe, expect, it } from 'vitest';
import { normalizeText, requestSummary } from '@/lib/requests/scrub';

const ZWSP = String.fromCharCode(0x200b);
const RLO = String.fromCharCode(0x202e);
const FW = (s: string) => [...s].map((c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).join(''); // full-width ASCII
const ARABIC = (s: string) => [...s].map((c) => String.fromCharCode(0x0660 + Number(c))).join('');
const P = 'Need a roof leak fixed this week. ';

/** Anything that still looks like a way to reach someone. */
function leaks(s: string): string[] {
  const found: string[] = [];
  if (/@|\uFF20/.test(s)) found.push('@');
  if (/https?:|www|\.[a-z]{2,}\b|\bdot\b/i.test(s)) found.push('link');
  if ((s.match(/\d/g) ?? []).length >= 7) found.push('7+ digits');
  if (/\b(?:gmail|yahoo|hotmail|outlook|icloud|proton)/i.test(s)) found.push('mail provider');
  if (/[\u0660-\u0669\uFF10-\uFF19]/.test(s)) found.push('non-ascii digits');
  if (/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/.test(s)) found.push('invisible');
  if (/[<>]/.test(s)) found.push('html');
  return found;
}

const CASES: [string, string, string[]][] = [
  // Names, lower case and at the start of a sentence
  ['i am / this is', 'i am john smith and my roof is leaking badly. this is john smith', ['john', 'smith']],
  ['thanks, name', 'my roof is leaking badly, please help. thanks, john smith', ['john', 'smith']],
  ['signature line in lower case', `${P}\nsarah connor`, ['sarah', 'connor']],
  ['my wife <name>', `${P}talk to my wife linda`, ['linda']],
  ['name at sentence start', 'John Smith needs his roof fixed', ['John', 'Smith']],
  ['<name> residence', 'Smith residence needs a roof fixed', ['Smith']],
  ['<name> here', `${P}Sarah Connor here`, ['Sarah', 'Connor']],
  ['possessive name', `${P}roof at john smith's house`, ['john', 'smith']],
  ['zero-width inside a trigger', `${P}my na${ZWSP}me is John Smith`, ['John', 'Smith']],
  ['call <name>', `${P}call john at home`, ['john']],
  ['ask for <name>, any case', `${P}ASK FOR mike when you come`, ['mike', 'MIKE', 'Mike']],
  ["i'm <name>", "i'm bob jones, need two movers on saturday", ['bob', 'jones']],
  // Phones in any grouping or separator
  ['404-555-01-99', `${P}404-555-01-99`, ['555', '0199', '01-99']],
  ['40 4555 0199', `${P}40 4555 0199`, ['4555', '0199']],
  ['4 045 550 199', `${P}4 045 550 199`, ['045', '550', '199']],
  ['letter O for zero', `${P}404 555 O199`, ['404', '555', 'O199']],
  ...['/', ',', '_', '*', ':', '|', "'", '~', '=', '\u2022'].map(
    (sep): [string, string, string[]] => [`separator ${sep}`, `${P}404${sep}555${sep}0199`, ['404', '555', '0199']],
  ),
  ['spaced-out digits', `${P}ring 4 0 4 5 5 5 0 1 9 9`, ['4 0 4', '0 1 9 9']],
  ['spelled-out digits', `${P}four oh four five five five zero one nine nine`, ['four oh four', 'zero one nine']],
  ['full-width digits', `${P}${FW('4045550199')}`, ['404', '555', '0199']],
  ['Arabic-Indic digits', `${P}${ARABIC('4045550199')}`, ['404', '555', '0199']],
  ['zero-width between groups', `${P}404${ZWSP}555${ZWSP}0199`, ['404', '555', '0199']],
  ['vanity number', `${P}1-800-FLOWERS`, ['800', 'FLOWERS', 'flowers']],
  ['UK number', `${P}07700 900123`, ['07700', '900123']],
  // Emails and handles
  ['handle provider tld', `${P}johndoe77 gmail com`, ['johndoe77', 'gmail']],
  ['handle at provider', `${P}johndoe77 at gmail`, ['johndoe77', 'gmail']],
  ['provider: handle', `${P}gmail: johndoe77`, ['johndoe77', 'gmail']],
  ['handle (provider)', `${P}sarahconnor84 (gmail)`, ['sarahconnor84', 'gmail']],
  ['dotted handle at provider', `${P}sarah.connor at gmail`, ['sarah', 'connor', 'gmail']],
  ['any TLD', `${P}johndoe77 at protonmail dot ch`, ['johndoe77', 'protonmail', 'dot ch']],
  ['co dot uk', `${P}bob at yahoo dot co dot uk`, ['bob', 'yahoo', 'dot uk', 'uk']],
  ['braces', `${P}sarah{at}gmail{dot}com`, ['sarah', 'gmail']],
  ['dashes', `${P}sarah-at-gmail-dot-com`, ['sarah', 'gmail']],
  ['full-width @ and dot', `${P}sarah${String.fromCharCode(0xff20)}gmail${String.fromCharCode(0xff0e)}com`, ['sarah', 'gmail']],
  ['insta handle', `${P}insta johnny_roofs`, ['johnny', 'roofs']],
  ['facebook dotted handle', `${P}facebook johnny.doe.77`, ['johnny', 'doe', '77']],
  ['snap handle', `${P}snap: johnnyd77`, ['johnnyd77']],
  ['bare @handle', `${P}find me @roofguy`, ['roofguy']],
  // Links
  ['any TLD with path', `${P}mysite.xyz/photos`, ['mysite', 'photos']],
  ['dev TLD', `${P}example.dev`, ['example']],
  ['markdown link', `${P}[click here](evil.example/x)`, ['click here', 'evil']],
  ['spoken domain', `${P}mysite dot com slash photos`, ['mysite', 'photos']],
  ['www with no TLD', `${P}see www mysite`, ['mysite', 'www']],
  ['https link', `${P}https://evil.example/a?b=1`, ['evil', 'https']],
  // Addresses
  ['lowercase street, no suffix', 'leaky roof at 1234 peachtree needs fixing, house is on peachtree and 10th', ['1234', '10th']],
  ['number and one word', `${P}500 broadway`, ['500', 'broadway']],
  ['named street, number', `${P}i live on mlk jr drive near the kroger, number 88`, ['mlk', 'drive', '88']],
  ['spelled-out house number', `${P}twelve thirty four peachtree street`, ['twelve', 'thirty', 'peachtree']],
  ['building number', `${P}building 7`, ['building 7', ' 7']],
  ['capitalized street, no suffix', `${P}123 Main`, ['123', 'Main']],
  ['house number with prefix', `${P}house number 4321 on Roswell`, ['4321', 'Roswell']],
  ['city state zip', `${P}near Kroger, Marietta GA 30062`, ['30062', 'Marietta']],
  ['suffix in lower case', `${P}at 88 old mill rd`, ['88', 'mill']],
  // Long digit runs and codes
  ['ssn and date of birth', `${P}ssn 123-45-6789 dob 01/02/1980`, ['6789', '1980', '123-45']],
  ['card number', `${P}card 4111 1111 1111 1111`, ['4111', '1111']],
  ['gate code', `${P}gate code 4821, we are away till friday`, ['4821']],
  // HTML and invisible characters
  ['script tag', `${P}<script>alert(1)</script>`, ['<script', 'script>']],
  ['img tag', `${P}<img src=x onerror=alert(1)>`, ['onerror', '<img']],
  ['bidi override', `${P}${RLO}evil`, [RLO]],
];

describe('requestSummary: review P1-1 bypasses are closed', () => {
  it.each(CASES)('%s', (_label, text, mustNotContain) => {
    const out = requestSummary(text) ?? '';
    expect(leaks(out)).toEqual([]);
    for (const bad of mustNotContain) expect(out.toLowerCase()).not.toContain(bad.toLowerCase());
    expect(out.length).toBeLessThanOrEqual(140);
  });

  it('keeps an ordinary job description intact (quantities, years, money)', () => {
    const text = 'Need about 150 shingles replaced and 200 feet of gutter, house built in 1985, budget $1500.';
    expect(requestSummary(text)).toBe(text);
    expect(requestSummary('I am looking for a roofer, this is urgent. Thanks so much!')).toBe(
      'I am looking for a roofer, this is urgent. Thanks so much!',
    );
    expect(requestSummary('My water heater is out and the basement is flooding. Call anytime please.')).toBe(
      'My water heater is out and the basement is flooding. Call anytime please.',
    );
  });
});

describe('normalizeText', () => {
  it('folds full-width and other-script digits to ASCII and deletes invisible characters and tags', () => {
    expect(normalizeText(FW('404'))).toBe('404');
    expect(normalizeText(ARABIC('4045'))).toBe('4045');
    expect(normalizeText(`a${ZWSP}b${RLO}c`)).toBe('abc');
    expect(normalizeText('x <b>y</b> z')).toBe('x  y  z');
  });
});
