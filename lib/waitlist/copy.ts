/**
 * Copy for the "Coming to your area" waitlist card on /check. Pure data, safe to import from client code.
 * The words say what happens: we keep an email for a ZIP and tell the person when Holler covers it. No date, no promise of a date,
 * no count. "Covering" means Holler reads a local source (permits, city requests) near that place; weather feeds reach every ZIP.
 */
export const WAITLIST = {
  eyebrow: 'Coming to your area',
  heading: (place: string) => `Holler isn't covering ${place} yet.`,
  /**
   * Round 23: a ZIP can have a local source and still have nothing for one trade (Dallas reads a 311 feed but produced 0 lawn-care
   * records an owner could act on in 14 days). That visitor gets this heading and note instead, so the page never says Holler is not
   * in their town when it is, and never offers a trial for a trade with an empty feed.
   */
  // Round 24 (review P2-2): true with and without a list of records underneath. The note keeps its round 23 clause, which the alert
  // email quotes (tests/email/int24-coherence.test.ts).
  tradeHeading: (trade: string, place: string) => `Not enough ${trade} work near ${place} yet.`,
  tradeNote: 'Holler reads records near you, but lately none of them has been work for this trade that a crew could act on. Pick another trade above, or leave your email and we will tell you when this one is worth paying for.',
  intro: "Leave your email and we'll tell you when it does.",
  note: 'Storm reports and weather alerts reach every ZIP. Permits and city requests need a local source, and none is connected near you yet.',
  emailLabel: 'Your email',
  tradeLabel: 'What you do',
  button: "Tell me when it's covered",
  sending: 'Saving...',
  privacy: 'We send one email to confirm your address, then use it only to tell you when this area is covered. We never sell it.',
  thanks: (place: string) => `Check your email and press the link to confirm. Then you are on the list for ${place}.`,
  errors: {
    email: 'Check your email address.',
    invalid: 'Check the form and try again.',
    /** Round 24: the server names the field it refused. Equal to the dictionary's wl.err.* keys (tests/waitlist/trades-r24.test.ts). */
    trade: 'This trade is not on the list for this ZIP: Holler already has something for it here. Pick another trade, or check this one above.',
    zip: 'We could not find that ZIP code. Check it and try again.',
    limited: 'Too many tries. Wait a bit, then try again.',
    unavailable: 'Could not save that. Try again later.',
    network: 'We could not reach the server. Check your connection and try again.',
  },
} as const;

/**
 * Round 24 INT2: the card's words for another language, every one a finished string (the server page fills the place and trade in), so
 * the client card never imports a dictionary. /es/check builds them from lib/i18n/es.ts (`wl.card.*`, `wl.err.*`, `chk.h.*`); English
 * keeps WAITLIST above, byte for byte.
 */
export interface WaitlistCardWords {
  eyebrow: string;
  heading: string;
  intro: string;
  note: string;
  emailLabel: string;
  tradeLabel: string;
  button: string;
  sending: string;
  privacy: string;
  thanks: string;
  errors: { [K in keyof typeof WAITLIST.errors]: string };
}

/** Where a signup came from. Stored as `page`. Only values in this list are ever stored. */
export const WAITLIST_PAGES = ['check'] as const;
export const WAITLIST_EMAIL_MAX = 254;
export const WAITLIST_HONEYPOT = 'leave_blank';

/**
 * Round 24 (review P2-3): what the card says for a refused submit, from the server's { ok, error, field } answer. A refusal always says
 * what is wrong: the email, the ZIP, or the trade (not on this ZIP's list); only an answer with no field falls back to the general line.
 */
export function waitlistRefusal(
  data: { ok?: boolean; error?: string; field?: string } | null,
  errors: WaitlistCardWords['errors'] = WAITLIST.errors,
): { emailError: string | null; message: string | null } {
  if (data?.ok) return { emailError: null, message: null };
  if (data?.error === 'invalid' && data.field === 'email') return { emailError: errors.email, message: null };
  if (data?.error === 'invalid' && data.field === 'trade') return { emailError: null, message: errors.trade };
  if (data?.error === 'invalid' && data.field === 'zip') return { emailError: null, message: errors.zip };
  if (data?.error === 'invalid') return { emailError: null, message: errors.invalid };
  if (data?.error === 'limited') return { emailError: null, message: errors.limited };
  return { emailError: null, message: errors.unavailable };
}
