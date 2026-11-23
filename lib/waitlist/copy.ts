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
  tradeHeading: (trade: string, place: string) => `Holler has nothing for ${trade} near ${place} yet.`,
  tradeNote: 'Holler reads records near you, but lately none of them has been work for this trade. Pick another trade above, or leave your email and we will tell you when this one is worth paying for.',
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
    limited: 'Too many tries. Wait a bit, then try again.',
    unavailable: 'Could not save that. Try again later.',
    network: 'We could not reach the server. Check your connection and try again.',
  },
} as const;

/** Where a signup came from. Stored as `page`. Only values in this list are ever stored. */
export const WAITLIST_PAGES = ['check'] as const;
export const WAITLIST_EMAIL_MAX = 254;
export const WAITLIST_HONEYPOT = 'leave_blank';
