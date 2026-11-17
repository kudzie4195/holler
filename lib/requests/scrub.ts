import { publicSummary, MAX_SUMMARY_CHARS } from '@/lib/signals/adapters/permit-privacy';

/**
 * Filtered text of a resident's description. It is NEVER public: the public holler_signals row carries no free text at all. The
 * filtered text is kept in holler_requests.public_summary (service role only) and shown only to businesses whose own match points at
 * the request (their feed and their alert email) and to the resident in their own emails. It still goes through a strict filter
 * because the business is a stranger. When unsure, text is dropped: over-removal is fine, a leak is not.
 *
 *  0. normalizeText: Unicode NFKC (full-width letters, digits and "＠" become ASCII), every decimal digit of any script becomes 0-9,
 *     zero-width, bidi and other invisible characters are deleted, HTML tags are removed.
 *  1. removePatterns: links (any TLD, "www" with or without one, markdown links, "dot com"), emails (plain, "at"/"dot" spelled out
 *     in any bracket style, mail-provider names with the words around them), social handles, any run of 7 or more digits with up to 3
 *     non-letters between them (phones in any grouping, card and social security numbers, dates), spelled-out digit runs, vanity
 *     numbers, codes ("gate code 4821"), street addresses with or without a suffix, intersections, unit numbers.
 *  2. removeNameWords: names after trigger phrases in any case ("i am", "i'm", "my name is", "this is", "thanks,", "ask for", "call",
 *     "talk to my wife", ...), common first names and the word after them, possessive names ("john's house"), "Smith residence",
 *     "Sarah here", capitalized words that are not at the start of a sentence, all-caps words that are not common acronyms, house
 *     numbers, and a short last line that is only a name (a signature).
 *  3. publicSummary from permit-privacy.ts (the scrubber the public permit records use) and a final pass of the strongest patterns.
 * Returns null when nothing useful is left.
 */

// ---------------------------------------------------------------------------------------------------------------------------------
// 0. Normalise
// ---------------------------------------------------------------------------------------------------------------------------------

/** Any Unicode decimal digit (Arabic-Indic, Devanagari, ...) as its ASCII digit. Digit blocks are contiguous runs of ten. */
function asciiDigits(s: string): string {
  return s.replace(/\p{Nd}/gu, (ch) => {
    const cp = ch.codePointAt(0)!;
    if (cp >= 48 && cp <= 57) return ch;
    let start = cp;
    while (start > 0 && /\p{Nd}/u.test(String.fromCodePoint(start - 1))) start--;
    return String((cp - start) % 10);
  });
}

/** Exported for tests. Never changes letters other than by NFKC; removes what a reader cannot see. */
export function normalizeText(raw: string): string {
  return asciiDigits(raw.normalize('NFKC'))
    .replace(/[\p{Cf}\p{Co}\p{Cs}\u034F\u115F\u1160\u3164\uFFA0]/gu, '') // zero-width, bidi overrides, joiners, fillers
    .replace(/[\u2028\u2029\u0085]/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
    .replace(/<[^<>]*>/g, ' ') // HTML tags
    .replace(/[<>]/g, ' ')
    .replace(/[\u2018\u2019\u02BC\u2032`\u00B4]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 1. Patterns
// ---------------------------------------------------------------------------------------------------------------------------------

const SUFFIXES =
  'street|st|avenue|ave|av|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|way|place|pl|circle|cir|parkway|pkwy|highway|hwy|' +
  'terrace|ter|trail|trl|pike|run|loop|row|square|sq|crossing|xing|point|pt|ridge|landing|commons|cove|bend|path|alley|aly|' +
  'freeway|fwy|expressway|expy|turnpike|tpke|route|rte|close|crescent|cres';
const FULL_SUFFIXES =
  'street|avenue|road|drive|lane|boulevard|court|parkway|highway|terrace|trail|pike|circle|place|way|crossing|ridge|freeway|' +
  'expressway|turnpike|route|st|ave|rd|dr|ln|blvd|ct|pkwy|hwy|cir';
const NUM_WORDS =
  'zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|' +
  'nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety|hundred|thousand';

const EMAIL_RE = /[\w.+'-]+@[\w-]+(?:\.[\w-]+)*/g;
/** "john at gmail dot com", "sarah{at}gmail{dot}com", "sarah-at-gmail-dot-com", "a (at) b . org": any TLD, the dot part required. */
const OBFUSCATED_EMAIL_RE = new RegExp(
  String.raw`[\w.+-]+\s*(?:@|[\[({]\s*at\s*[\])}]|-at-|_at_|\s+at\s+)\s*[\w-]+` +
    String.raw`(?:\s*(?:\.(?=\s*[\w-])|[\[({]\s*dot\s*[\])}]|-dot-|_dot_|\s+dot\s+)\s*[\w-]+)+`,
  'gi',
);
/** A mail provider named anywhere, with the handle before it and the TLD or handle after it. */
const PROVIDER_RE = new RegExp(
  String.raw`(?:[\w.+-]*[\w+-]\s*(?:\(|\[|\s+at\s+|\s+on\s+|\s*@\s*|\s+)\s*)?` +
    String.raw`\b(?:g\s?mail|googlemail|yahoo|ymail|rocketmail|hotmail|outlook|icloud|aol|proton(?:\s?mail)?|pm\.me|msn|comcast|` +
    String.raw`xfinity|verizon|bellsouth|sbcglobal|att\.net|earthlink|charter|cox\.net|gmx|zoho|mail\.com|live\.com|me\.com|mac\.com|tutanota|fastmail|yandex)\b` +
    String.raw`[\])]?(?:\s*(?::|-|is\b|\bat\b)\s*[\w.+-]+)?(?:\s*(?:\.|\bdot\b)?\s*(?:com|net|org|co|uk|ch|de|io|us|ca|me|fr|au)\b)*`,
  'gi',
);
const HANDLE_RE = /(^|[^\w])@[\w.]{1,}/g;
const SOCIAL_RE =
  /\b(?:insta(?:gram)?|ig|facebook|fb|snap(?:chat)?|tiktok|tik tok|twitter|whats\s?app|telegram|venmo|cash\s?app|zelle|paypal|linkedin|nextdoor|youtube|wechat|kik|discord|user\s?name|screen\s?name)\b[\s:@-]*(?:is\s+|at\s+)?(?:@?[\w.-]*\d[\w.-]*|@?[\w-]+(?:[._][\w-]+)*)?/gi;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S*|\bwww\b\S*(?:\s+(?:dot\s+)?[\w./-]+){0,2}/gi;
/** Handle-like tokens: dotted lower-case words ("johnny.doe.77", "sarah.connor"), anything with an underscore, letters then digits. */
const HANDLE_LIKE_RE = /\b[A-Za-z][\w-]*(?:\.[a-z0-9_][\w-]*)+\b|\b\w*_\w*\b|\b[A-Za-z]{3,}\d{2,}\w*\b/g;
const MARKDOWN_LINK_RE = /\[[^\]]*\]\([^)]*\)/g;
/** Any bare domain: a TLD of 2 to 24 letters, all lower-case or all upper-case ("mysite.xyz/photos", "EXAMPLE.DEV"). */
const BARE_DOMAIN_RE = /\b[\w-]+(?:\.[\w-]+)*\.(?:[a-z]{2,24}|[A-Z]{2,24})\b(?:\/\S*)?/g;
/** "mysite dot com slash photos", "yahoo dot co dot uk". */
const SPOKEN_DOMAIN_RE = /(?:[\w-]+\s+){0,2}\bdot\s+[a-z]{2,6}\b(?:\s+(?:dot|slash)\s+[\w-]+)*/gi;
/** 7 or more digits, each separated from the next by at most 3 characters that are not letters: phones in any grouping and with any
 * separator, card numbers, social security numbers, dates of birth. */
const DIGIT_RUN_RE = /\d(?:[^\p{L}\d\n]{0,3}\d){6,}/gu;
const VANITY_RE =
  /(?:\b1[\s.-]*)?\(?\b8(?:00|33|44|55|66|77|88)\b\)?[\s.-]*[A-Za-z0-9-]{4,}|\b\d{3}[\s.-]+(?:\d{3}[\s.-]+)?[A-Z]{4,}\b|\b\d{3}[\s.-]+\d{3}[\s.-]+[A-Za-z]{4}\b/g;
const PHONE_WORD_RE = /\b(?:ph|phone|tel|cell|mobile|fax|number|no|num)\s*[:#.]?\s*\d[\d\s().-]*/gi;
const CODE_RE =
  /\b(?:ssn|social security(?:\s+(?:number|no))?|dob|date of birth|birth\s?date|card|credit card|debit card|cc|cvv|cvc|account|acct|routing|pin|gate code|gate|door code|code|passcode|password|lock\s?box|alarm code|key code|license|dl)\b[\s:#.-]*(?:(?:number|num|no|is|code)\b[\s:#.-]*)*[\w/.-]*\d[\w/.-]*/gi;
const SUFFIX_ONE = new RegExp(`^(?:${SUFFIXES})\\.?$`, 'i');
const NUM_WORDS_GROUP = `(?:(?:${NUM_WORDS})[\\s-]+){1,6}`;
const STREET_RE = new RegExp(
  String.raw`(?:\b\d{1,6}[A-Za-z]?|\b${NUM_WORDS_GROUP})\s*(?:[NSEW]\.?\s+)?(?:[A-Za-z0-9'.-]+\s+){0,3}(?:${SUFFIXES})\b\.?(?:\s+(?:NE|NW|SE|SW|N|S|E|W)\b\.?)?`,
  'gi',
);
/** "i live on mlk jr drive", "off old mill road": a street named by its suffix with no number. */
const NAMED_STREET_RE = new RegExp(
  String.raw`\b(?:on|at|off|along|near|of|onto|from)\s+((?:[A-Za-z][\w'.-]*\s+){1,3})(?:${FULL_SUFFIXES})\b\.?`,
  'gi',
);
/** "on peachtree and 10th", "corner of main & 5th". */
const INTERSECTION_RE = /\b(?:on|at|off|near|by|corner of)\s+([\w'.-]+)\s+(?:and|&|at|\/)\s+([\w'.-]+)/gi;
const ORDINAL_RE = /\b\d{1,4}(?:st|nd|rd|th)\b/gi;
const ORDINAL_ONE = /^\d{1,4}(?:st|nd|rd|th)$/i;
const UNIT_RE = /(?:\b(?:apt|apartment|suite|ste|unit|lot|bldg|building|box|po box|p\.o\. box)\.?\s*#?\s*[\w-]*\d[\w-]*|#\s*\d+\w*)/gi;
const STATE_ZIP_RE = /\b[A-Za-z]{2}\.?\s+\d{5}(?:-\d{4})?\b/g;

const SPOKEN_NUM = new Map<string, number>(
  NUM_WORDS.split('|').map((w) => [w, /^(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)$/.test(w) ? 1 : w === 'thousand' ? 3 : 2]),
);
SPOKEN_NUM.set('o', 1);
SPOKEN_NUM.set('double', 1);
SPOKEN_NUM.set('triple', 1);

/** Runs of spelled-out digits (mixed with digits or not) worth 7 digits or more: "four oh four five five five zero one nine nine". */
function removeSpokenNumbers(text: string): string {
  const parts = text.split(/(\s+)/);
  const word = (p: string) => p.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  let i = 0;
  while (i < parts.length) {
    if (/^\s+$/.test(parts[i]) || !parts[i]) {
      i++;
      continue;
    }
    let j = i;
    let digits = 0;
    let numeric = 0;
    while (j < parts.length) {
      const p = parts[j];
      if (/^\s+$/.test(p) || !p) {
        j++;
        continue;
      }
      const w = word(p);
      if (SPOKEN_NUM.has(w)) {
        digits += SPOKEN_NUM.get(w)!;
        numeric++;
      } else if (/^\d+$/.test(w)) {
        digits += w.length;
        numeric++;
      } else if (w === '' && /^[-,./|:]+$/.test(p)) {
        // separator token
      } else break;
      j++;
      if (/[.!?]$/.test(p) && !/^\d/.test(p)) break;
    }
    if (digits >= 7 && numeric >= 3) {
      for (let k = i; k < j; k++) if (!/^\s+$/.test(parts[k])) parts[k] = ' ';
      i = j;
    } else i++;
  }
  return parts.join('');
}

/** Letters that stand in for digits inside a number ("404 555 O199", "4O4-555-0l99"). */
function fixDigitLookalikes(text: string): string {
  return text.replace(/[\w|().-]*\d[\w|().-]*/g, (tok) =>
    /^[\dOoIl|().-]+$/.test(tok) && /[OoIl|]/.test(tok) ? tok.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1') : tok,
  );
}

const ARTICLES = new Set(['the', 'my', 'our', 'a', 'an', 'this', 'that', 'your', 'his', 'her', 'their', 'its', 'same', 'other']);

function removePatterns(text: string): string {
  let t = text.replace(MARKDOWN_LINK_RE, ' ');
  t = t.replace(URL_RE, ' ');
  t = t.replace(EMAIL_RE, ' ');
  t = t.replace(OBFUSCATED_EMAIL_RE, ' ');
  t = t.replace(PROVIDER_RE, ' ');
  t = t.replace(SOCIAL_RE, ' ');
  t = t.replace(HANDLE_RE, '$1 ');
  t = t.replace(BARE_DOMAIN_RE, ' ');
  t = t.replace(SPOKEN_DOMAIN_RE, ' ');
  t = t.replace(HANDLE_LIKE_RE, ' ');
  t = fixDigitLookalikes(t);
  t = t.replace(VANITY_RE, ' ');
  t = t.replace(CODE_RE, ' ');
  t = t.replace(PHONE_WORD_RE, (m) => (m.replace(/\D/g, '').length >= 3 ? ' ' : m));
  t = t.replace(DIGIT_RUN_RE, ' ');
  t = removeSpokenNumbers(t);
  t = t.replace(STREET_RE, ' ');
  t = t.replace(NAMED_STREET_RE, (m, words: string) =>
    words
      .trim()
      .split(/\s+/)
      .every((w) => ARTICLES.has(w.toLowerCase()))
      ? m
      : ' ',
  );
  t = t.replace(INTERSECTION_RE, (m, a: string, b: string) => {
    const street = (raw: string) => {
      const w = raw.replace(/[^\w]+$/, '');
      return ORDINAL_ONE.test(w) || SUFFIX_ONE.test(w) || /^[A-Z]/.test(w);
    };
    return street(a) || street(b) ? ' ' : m;
  });
  t = t.replace(ORDINAL_RE, ' ');
  t = t.replace(UNIT_RE, ' ');
  t = t.replace(STATE_ZIP_RE, ' ');
  return t;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// 2. Names and house numbers (token rules)
// ---------------------------------------------------------------------------------------------------------------------------------

const RELATIONS =
  'wife husband son daughter mom mother dad father neighbor neighbour landlord landlady tenant partner brother sister boyfriend ' +
  'girlfriend fiance fiancee roommate grandma grandpa grandmother grandfather aunt uncle cousin friend kid kids child spouse ' +
  'mother-in-law father-in-law manager owner super superintendent nephew niece stepdad stepmom';

/** Phrases after which the next words are a name or a way to reach someone. Matched in any case. `weak` triggers also start ordinary
 * sentences ("i am looking", "this is urgent"), so their captured words must not be common words. */
const TRIGGERS: { words: string[]; weak?: boolean; startOnly?: boolean; max?: number }[] = [
  { words: ['my', 'name', 'is'], max: 3 },
  { words: ['my', "name's"], max: 3 },
  { words: ['my', 'names'], max: 3 },
  { words: ['name', 'is'], max: 3 },
  { words: ["name's"], max: 3 },
  { words: ['i', 'am', 'called'] },
  { words: ["i'm", 'called'] },
  { words: ['i', 'am'], weak: true },
  { words: ["i'm"], weak: true },
  { words: ['im'], weak: true },
  { words: ['this', 'is'], weak: true },
  { words: ['call', 'me'] },
  { words: ['text', 'me'] },
  { words: ['ask', 'for'] },
  { words: ['talk', 'to'] },
  { words: ['talk', 'with'] },
  { words: ['speak', 'to'] },
  { words: ['speak', 'with'] },
  { words: ['owner', 'is'] },
  { words: ['landlord', 'is'] },
  { words: ['thank', 'you'], weak: true },
  { words: ['thanks'], weak: true },
  { words: ['thx'], weak: true },
  { words: ['ty'], weak: true },
  { words: ['best', 'regards'] },
  { words: ['kind', 'regards'] },
  { words: ['regards'] },
  { words: ['sincerely'] },
  { words: ['signed'] },
  { words: ['cheers'], weak: true },
  { words: ['best'], weak: true, startOnly: true },
  { words: ['from'], weak: true, startOnly: true },
  { words: ['love'], weak: true, startOnly: true },
  { words: ['call'], weak: true },
  { words: ['text'], weak: true },
  { words: ['contact'], weak: true },
  { words: ['reach'], weak: true },
  { words: ['email'], weak: true },
  { words: ['e-mail'], weak: true },
  { words: ['mr'] },
  { words: ['mrs'] },
  { words: ['ms'] },
  { words: ['miss'], weak: true },
  ...RELATIONS.split(' ').map((r) => ({ words: ['my', r], weak: true })),
  ...RELATIONS.split(' ').map((r) => ({ words: ['our', r], weak: true })),
].sort((a, b) => b.words.length - a.words.length);

/** Words that are never part of a captured name. */
const STOP = new Set(
  (
    'me us at on in or and for to about if when after before anytime any anyone someone the a an my our i we please pls plz asap ' +
    'today tonight tomorrow now back with is am are was were be been being need needs needed looking want wants wanted from so but ' +
    'he she they him her them this that it its it\'s between during by soon later first quote quotes estimate estimates help you your ' +
    'here there do does did can could would will should has have had not no yes very really also just still too again much more most ' +
    'some all both each every few many lot lots of off out up down over under into onto than then because since while until till ' +
    'as how what which who whom whose why where though although yet either neither nor via per thru through around near next last ' +
    'this that these those one two three four five six seven eight nine ten ' +
    "won't can't don't doesn't isn't wasn't didn't wouldn't couldn't shouldn't haven't hasn't hadn't aren't weren't ain't " +
    'lives works says said thinks thought wants has got gets made makes called told tells asked asks left went goes came comes saw ' +
    'sees found knows knew put keeps kept uses used tried tries likes loves hates noticed heard paid pays owns owned rents bought sold ' +
    'moved fell broke broken let lets says'
  ).split(' '),
);

/** Common words a weak trigger may be followed by ("i am retired", "this is urgent", "thanks again"). Never captured as a name. */
const COMMON = new Set(
  (
    'urgent emergency important serious bad worse worst terrible awful horrible good great fine ok okay sure sorry afraid worried ' +
    'concerned new old older elderly retired disabled pregnant home away busy available free able unable ready glad happy desperate ' +
    'renting moving selling buying hoping trying getting having needing wondering interested located based local nearby close ' +
    'single alone tired sick stuck flexible open around again advance anyway all everyone everybody guys folks much lot ' +
    'homeowner owner renter tenant landlord resident neighbor neighbour customer client senior veteran vet nurse teacher mom dad ' +
    'parent mother father student realtor contractor manager the leaking broken flooded leak roof water house home kitchen ' +
    'basement attic garage yard fence tree trees gutter gutters window windows door doors floor floors wall walls ceiling sink toilet ' +
    'shower bath bathroom heater furnace ac hvac pipe pipes drain sewer septic deck patio driveway lawn grass pool porch stairs ' +
    'room rooms bedroom office shop store car truck apartment condo townhouse building job work project repair repairs install ' +
    'replace quote estimate price cost budget week weekend morning afternoon evening night day days hours time soon quick quickly ' +
    'asap please help someone somebody anyone anybody company business service services pro pros professional plumber roofer ' +
    'electrician painter mover movers cleaner landscaper handyman tech technician guy person people team crew'
  ).split(' '),
);

const DAYS_MONTHS = new Set(
  (
    'monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun january february march ' +
    'april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec'
  ).split(' '),
);
const PRONOUNS = new Set(["i", "i'm", "i've", "i'll", "i'd", 'im', 'ive']);
const ACRONYMS = new Set(
  (
    'AC HVAC ASAP DIY LED TV HOA GFCI GFI AFCI EV USA US OK PM AM BBQ DJ IT POS ADU ATV RV SUV ID FYI PVC UV BTU SEER LLC ' +
    'URGENT HELP PLEASE NOW TODAY NOT NO ONLY ASAP CPVC PEX ABS OSB HVLS CO CO2 EMT ROI'
  ).split(' '),
);

/** Common US first names and surnames that are not also ordinary words. Matched in any case, with the next name-like word. */
const NAMES = new Set(
  (
    'john johnny jon michael mike david dave james jim jimmy robert rob bob bobby mary patricia pat jennifer jen jenny linda elizabeth ' +
    'liz beth william richard rick joseph joe thomas tom tommy charles charlie christopher chris daniel dan danny matthew anthony ' +
    'tony donald don steven steve stephen paul andrew andy joshua josh kenneth ken kevin brian george timothy tim ronald ron edward ed ' +
    'eddie jason jeffrey jeff ryan jacob gary nicholas eric jonathan larry justin scott brandon benjamin ben samuel sam gregory ' +
    'greg alexander alex patrick raymond dennis jerry tyler aaron jose adam nathan nate henry douglas doug zachary zach peter pete ' +
    'kyle ethan walter noah jeremy keith roger terry sean gerald carl harold dylan arthur lawrence jesse bryan billy bruce gabriel ' +
    'alan albert willie elijah wayne randy vincent roy ralph russell bradley philip phil eugene barbara susan sue jessica karen ' +
    'nancy lisa betty margaret maggie sandra ashley kimberly kim emily donna michelle carol amanda melissa deborah debbie stephanie ' +
    'rebecca becky sharon laura cynthia kathleen kathy amy angela shirley anna brenda pamela pam emma nicole helen samantha katherine ' +
    'kate christine debra rachel carolyn janet catherine maria heather diane ruth julie olivia joyce kelly lauren christina joan evelyn ' +
    'judith judy megan andrea cheryl hannah jacqueline martha gloria teresa ann anne sara sarah abigail alice sophia denise doris ' +
    'marilyn danielle beverly isabella theresa diana natalie brittany marie kayla alexis lori tanya tasha keisha latoya shanice ' +
    'jamal tyrone darnell deshawn marcus andre terrell jerome reggie juan carlos luis miguel jorge pedro manuel ricardo javier ' +
    'connor smith johnson williams jones garcia miller davis rodriguez martinez hernandez lopez gonzalez wilson anderson thomas ' +
    'taylor moore jackson thompson harris clark lewis robinson wright mitchell roberts turner phillips campbell parker evans ' +
    'edwards collins stewart sanchez morris rogers murphy bailey rivera cooper richardson howard torres peterson ramirez watson ' +
    'bennett barnes henderson coleman jenkins patterson hughes flores butler simmons bryant griffin diaz nguyen kim patel shah ' +
    'okafor oconnor obrien mcdonald sullivan kennedy fitzgerald'
  ).split(' '),
);

const UNIT_WORDS = new Set(
  (
    'sq sqft square ft feet foot inch inches in yards yard yd yds meters m gallon gallons gal lb lbs pound pounds ton tons year years ' +
    'yr yrs month months day days week weeks hour hours hr hrs minute minutes min mins am pm dollars dollar bucks k percent % degrees ' +
    'deg x by sf lf panels shingles squares trees windows doors rooms bedrooms bathrooms stories story floors amp amps volt volts ' +
    'watt watts btu cfm psi gpm mph miles mile mi people units pieces boxes items bags'
  ).split(' '),
);

/** Prefix words after which a number is a house, building or unit number. */
const NUMBER_PREFIX = new Set(['number', 'num', 'no', 'house', 'building', 'bldg', 'address', 'addr', 'unit', 'apt', 'lot', 'box', '#']);
const PLACE_PREFIX = new Set(['at', 'on', 'is', 'live', 'lives', 'living', 'located', 'off']);

function bare(token: string): string {
  return token.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, '');
}
function isTitleCase(b: string): boolean {
  return /^[A-Z][a-z'-]+$/.test(b) || /^[A-Z]$/.test(b) || /^(?:Mc|Mac|O')[A-Z][a-z]+$/.test(b);
}
function isAllCaps(b: string): boolean {
  return /^[A-Z][A-Z'-]+$/.test(b);
}
/** Could be a name: letters only, 2 to 20, not a stop word, not a day or month. */
function nameLike(b: string): boolean {
  const l = b.toLowerCase();
  return /^[a-z][a-z'-]{1,19}$/i.test(b) && !STOP.has(l) && !DAYS_MONTHS.has(l) && !PRONOUNS.has(l);
}
function verbish(l: string): boolean {
  return /(?:ing|ed|ly)$/.test(l) && l.length > 4;
}

/** Text in capitals throughout ("MY ROOF IS LEAKING") is turned into sentence case first, so every word is not read as a name. */
function mostlyUpper(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 10) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length > 0.6;
}
function sentenceCase(text: string): string {
  return text.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase()).replace(/\bi\b/g, 'I');
}

function removeNameWords(text: string): string {
  const tokens = text.split(/\s+/).filter(Boolean);
  const keep = tokens.map(() => true);
  const lower = tokens.map((t) => bare(t).toLowerCase());
  const endsSentence = (t: string) => /[.!?]["')\]]*$/.test(t);
  const sentenceStart = (i: number) => i === 0 || endsSentence(tokens[i - 1]);

  // 1. Trigger phrases (any case) and the name-like words after them.
  for (let i = 0; i < tokens.length; i++) {
    for (const trig of TRIGGERS) {
      if (trig.words.some((w, k) => lower[i + k] !== w)) continue;
      if (trig.startOnly && !sentenceStart(i)) continue;
      const last = i + trig.words.length - 1;
      const captured: number[] = [];
      if (!endsSentence(tokens[last])) {
        for (let j = last + 1; j < tokens.length && captured.length < (trig.max ?? 2); j++) {
          const b = bare(tokens[j]);
          const l = b.toLowerCase();
          if (!b || !nameLike(b)) break;
          if (trig.weak && (COMMON.has(l) || verbish(l))) break;
          captured.push(j);
          if (/[.,;:!?)]$/.test(tokens[j])) break;
        }
      }
      if (captured.length === 0) break; // "call me at", "thanks so much": nothing name-like follows, keep the words
      for (let k = i; k <= last; k++) keep[k] = false;
      for (const j of captured) keep[j] = false;
      break;
    }
  }

  // 2. Common first names and surnames in any case, with the next name-like word (the surname).
  for (let i = 0; i < tokens.length; i++) {
    const l = lower[i].replace(/'s$/, '');
    if (!NAMES.has(l)) continue;
    keep[i] = false;
    const next = bare(tokens[i + 1] ?? '');
    if (!/[.,;:!?]$/.test(tokens[i]) && next && nameLike(next) && !COMMON.has(next.toLowerCase()) && !verbish(next.toLowerCase())) {
      keep[i + 1] = false;
    }
  }

  // 3. Possessive names ("john smith's house") and "<name> residence / family / household".
  for (let i = 0; i < tokens.length; i++) {
    const b = bare(tokens[i]);
    const m = /^([A-Za-z][\w-]*)'s$/i.exec(b);
    if (m && !STOP.has(m[1].toLowerCase()) && !COMMON.has(m[1].toLowerCase()) && !RELATIONS.split(' ').includes(m[1].toLowerCase())) {
      keep[i] = false;
      const prev = bare(tokens[i - 1] ?? '');
      if (i > 0 && !endsSentence(tokens[i - 1]) && prev && nameLike(prev) && !COMMON.has(prev.toLowerCase())) keep[i - 1] = false;
    }
    if (/^(?:residence|family|household|home|house|place|property)$/.test(lower[i]) && i > 0 && !endsSentence(tokens[i - 1])) {
      for (let k = i - 1; k >= Math.max(0, i - 2); k--) {
        const p = bare(tokens[k]);
        if (!p || !nameLike(p) || COMMON.has(p.toLowerCase()) || verbish(p.toLowerCase())) break;
        if (lower[i] !== 'residence' && lower[i] !== 'family' && lower[i] !== 'household' && !isTitleCase(p)) break;
        keep[k] = false;
        if (k > 0 && endsSentence(tokens[k - 1])) break;
      }
    }
  }

  // 4. "Sarah here", "sarah connor here." and "Sarah and I need ...": names that introduce the writer.
  for (let i = 0; i < tokens.length; i++) {
    if (!sentenceStart(i)) continue;
    let j = i;
    while (j < i + 2 && j < tokens.length && nameLike(bare(tokens[j])) && !COMMON.has(lower[j]) && !/[.,;:!?]$/.test(tokens[j])) j++;
    if (j > i && lower[j] === 'here' && (/[.,;:!?-]$/.test(tokens[j]) || j === tokens.length - 1 || /^[-\u2013]$/.test(tokens[j + 1] ?? ''))) {
      for (let k = i; k <= j; k++) keep[k] = false;
    }
    if (isTitleCase(bare(tokens[i])) && !PRONOUNS.has(lower[i]) && lower[i + 1] === 'and' && ['i', 'me', 'my', "i'm"].includes(lower[i + 2] ?? '')) {
      keep[i] = false;
    }
    // "John Smith needs ...": two capitalized words at the start of a sentence.
    const b0 = bare(tokens[i]);
    const b1 = bare(tokens[i + 1] ?? '');
    if (
      isTitleCase(b0) &&
      isTitleCase(b1) &&
      !/[.,;:!?]$/.test(tokens[i]) &&
      nameLike(b0) &&
      nameLike(b1) &&
      !COMMON.has(lower[i]) &&
      !DAYS_MONTHS.has(lower[i + 1])
    ) {
      keep[i] = false;
      keep[i + 1] = false;
    }
  }

  // 5. Capitalized words that are not at the start of a sentence, and all-caps words that are not common acronyms.
  for (let i = 0; i < tokens.length; i++) {
    const b = bare(tokens[i]);
    if (!b) continue;
    const l = b.toLowerCase();
    if (PRONOUNS.has(l) || DAYS_MONTHS.has(l)) continue;
    if (isAllCaps(b)) {
      if (!ACRONYMS.has(b.toUpperCase())) keep[i] = false;
      continue;
    }
    if (isTitleCase(b) && !sentenceStart(i)) keep[i] = false;
  }

  // 6. House, building and unit numbers: a number after "number", "#", "building" ...; a number of 3 to 6 digits after "at", "on",
  //    "live" ...; and any other number of 3 to 6 digits that is not a year, money or a quantity. The street name after it goes too.
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i];
    const b = bare(raw);
    if (!/^\d{1,6}[a-z]?$/i.test(b)) continue;
    if (/^\$/.test(raw) || /^[~\u2248]?\$/.test(tokens[i - 1] ?? '') || /%$/.test(raw)) continue;
    const digits = b.replace(/\D/g, '').length;
    const prev = lower[i - 1] ?? '';
    const prevRaw = tokens[i - 1] ?? '';
    const nextL = lower[i + 1] ?? '';
    const isYear = /^(?:19|20)\d{2}$/.test(b);
    const unitAfter = UNIT_WORDS.has(nextL) || /^(?:x|by)\d/.test(nextL) || /^\d/.test(nextL);
    const numberPrefix = (NUMBER_PREFIX.has(prev) || /#$/.test(prevRaw) || /^#/.test(raw)) && !endsSentence(prevRaw);
    const placePrefix = PLACE_PREFIX.has(prev) && !endsSentence(prevRaw) && digits >= 3 && !isYear;
    const bareNumber = digits >= 3 && !isYear && !unitAfter;
    if (!numberPrefix && !placePrefix && !bareNumber) continue;
    keep[i] = false;
    if (numberPrefix && NUMBER_PREFIX.has(prev)) keep[i - 1] = false;
    if (endsSentence(raw)) continue;
    for (let j = i + 1; j < Math.min(tokens.length, i + 3); j++) {
      const w = bare(tokens[j]);
      const l = w.toLowerCase();
      if (!w || !/^[a-z][\w'.-]*$/i.test(w) || STOP.has(l) || UNIT_WORDS.has(l) || DAYS_MONTHS.has(l)) break;
      if (!numberPrefix && !placePrefix && COMMON.has(l)) break;
      keep[j] = false;
      if (/[.,;:!?]$/.test(tokens[j])) break;
    }
  }

  // 7. A sentence that is only one to three capitalized words is a signature or a greeting with a name ("Thanks. Mike Jones").
  let s = 0;
  while (s < tokens.length) {
    let e = s;
    while (e < tokens.length - 1 && !endsSentence(tokens[e])) e++;
    const idx = Array.from({ length: e - s + 1 }, (_, k) => s + k).filter((k) => bare(tokens[k]));
    if (
      idx.length > 0 &&
      idx.length <= 3 &&
      idx.every((k) => isTitleCase(bare(tokens[k])) && !PRONOUNS.has(lower[k]) && !DAYS_MONTHS.has(lower[k])) &&
      !idx.every((k) => /^(?:thanks|thank|cheers|regards|hello|hi|hey|please|help|urgent)$/.test(lower[k]))
    ) {
      for (const k of idx) keep[k] = false;
    }
    s = e + 1;
  }

  return tokens.filter((_, i) => keep[i]).join(' ');
}

/** A last line of one to three words, none of them a common word, is a signature whatever its case ("sarah connor"). */
function isSignatureLine(line: string): boolean {
  const words = line.replace(/[.,;:!?\-\u2013]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 3) return false;
  return words.every((w) => {
    const l = w.toLowerCase();
    return (
      /^[a-z][a-z'-]*$/i.test(w) &&
      !STOP.has(l) &&
      !COMMON.has(l) &&
      !verbish(l) &&
      !DAYS_MONTHS.has(l) &&
      !/^(?:thanks|thank|cheers|regards|hello|hi|hey|please|help|urgent|asap|ty|thx)$/.test(l)
    );
  });
}

const DANGLING_END = /(?:\s+(?:at|on|to|me|or|and|via|by|for|call|text|email|is|my|number|from|with|the|a|an))+\s*([.!?]?)$/i;

function tidy(text: string): string {
  return text
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, ' ')
    .replace(/([,;:])\s*([.!?])/g, '$2')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/([.!?])\s*[,;:]+/g, '$1')
    .replace(/([.!?])(?:\s+[.!?]+)+/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:\-\u2013.!?]+|[\s,;:\-\u2013]+$/g, '')
    .replace(DANGLING_END, '$1')
    .trim();
}

/** Layer 1 only (exported for tests). */
export function requestPreScrub(raw: string): string {
  if (!raw) return '';
  let lines = normalizeText(raw)
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length >= 2 && isSignatureLine(lines[lines.length - 1])) lines = lines.slice(0, -1);
  // Each line break ends a sentence (a name on its own line is a signature).
  let t = lines
    .map((line) => (/[.!?]$/.test(line) ? line : `${line}.`))
    .join(' ')
    .replace(/[\u2014\u2013]/g, ' - ');
  if (mostlyUpper(t)) t = sentenceCase(t);
  t = removePatterns(t);
  t = removeNameWords(t);
  return tidy(t);
}

/** Final belt and braces: nothing that looks like contact details leaves this function. */
function safe(text: string): string {
  return tidy(
    normalizeText(text)
      .replace(URL_RE, ' ')
      .replace(EMAIL_RE, ' ')
      .replace(OBFUSCATED_EMAIL_RE, ' ')
      .replace(PROVIDER_RE, ' ')
      .replace(BARE_DOMAIN_RE, ' ')
      .replace(/@/g, ' ')
      .replace(DIGIT_RUN_RE, ' ')
      .replace(/\d{5,}/g, ' '),
  );
}

/**
 * The filtered description (max 140 characters) kept in holler_requests.public_summary, or null when nothing useful is left.
 * Not public: see the header of this file for who sees it.
 */
export function requestSummary(description: string): string | null {
  const pre = requestPreScrub(description);
  if (!pre) return null;
  const summary = publicSummary([pre], { max: MAX_SUMMARY_CHARS });
  if (!summary) return null;
  const out = safe(summary);
  return out.length >= 8 ? out : null;
}
