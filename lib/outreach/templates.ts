/**
 * First-contact notes for the "Who to contact" block. Static text, no AI. Each is 40 to 80 words once filled in, uses the
 * placeholders [your name], [your business] and [your phone] for the member to replace, makes no claim about damage the sender has
 * not seen, uses no pressure, and says "public record" only where it is natural.
 */
export type NoteKind =
  | 'sub-to-contractor'
  | 'trade-to-owner'
  | 'seller-to-new-business'
  | 'service-to-inspected'
  | 'supplier-to-awardee'
  | 'bidder-to-buyer'
  | 'door-hanger-storm'
  | 'door-hanger';

export interface NoteVars {
  /** Organisation name as the record gives it. */
  org?: string | null;
  /** Street address of the job site or business, when the record has one. */
  address?: string | null;
  /** Greeting for a note with no named recipient. */
  greeting?: 'Property owner' | 'Current resident';
}

const clean = (v: string | null | undefined) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

export function renderNote(kind: NoteKind, vars: NoteVars = {}): string {
  const org = clean(vars.org);
  const address = clean(vars.address);
  const at = address ? ` at ${address}` : ' near me';
  const greeting = vars.greeting ?? 'Property owner';
  switch (kind) {
    case 'sub-to-contractor':
      return `Hello${org ? ` ${org} team` : ''}. I saw your company named on a recent building permit${at}, in the public record. I run [your business], a small crew that takes on sub work. If you need help on this job, I can send a quote this week. If not, no problem. You can reach me at [your phone]. Thank you for your time. [your name]`;
    case 'trade-to-owner':
      return `Dear ${greeting}. A building permit was issued${at}, according to the public record. I am [your name] with [your business], and I work nearby. If you would like a second quote or have questions about the permitted work, call me at [your phone]. If you already have someone, thank you anyway. I will not follow up.`;
    case 'seller-to-new-business':
      return `Hello${org ? ` ${org} team` : ''}. Congratulations on the new business license. I am [your name] with [your business]. We work with local businesses that are just getting started, and I would like to introduce us. If a short call or a quote would help, reach me at [your phone]. If this is a busy time, I understand. Thanks for reading.`;
    case 'service-to-inspected':
      return `Hello${org ? ` ${org} team` : ''}. I am [your name] with [your business], a local service company. A recent city inspection of your place is in the public record, and I know follow-up visits can be a lot to handle. If any repair or service work is on your list, I am glad to give you a quote. If not, I wish you a smooth re-check. You can call me at [your phone].`;
    case 'supplier-to-awardee':
      return `Hello${org ? ` ${org} team` : ''}. Congratulations on your recent public award. I saw it in the public record. I am [your name] with [your business]. If you need a local supplier or a sub for part of the work, I would be glad to send pricing. Reach me at [your phone] whenever it suits you. Thank you for your time.`;
    case 'bidder-to-buyer':
      return `Hello${org ? ` ${org}` : ''}. I am [your name] with [your business]. I am reading the open solicitation your office posted and have one question about the scope. Are site visits or written questions still open, and what is the deadline? I will follow your office's process. You can reach me at [your phone]. Thank you.`;
    case 'door-hanger-storm':
      return `Hello neighbor. Severe weather has been forecast or reported for this area. I am [your name] with [your business], and I work nearby. If you have questions about your property, call me at [your phone]. I can take a look and give you a written quote. I will not pressure you. If you already have someone, thank you, and take care.`;
    case 'door-hanger':
      return `Hello neighbor. I am [your name] with [your business], and I work in this area. If you need help around your property, call me at [your phone]. I can take a look and give you a written quote. There is no obligation. If you already have someone you trust, thank you, and have a good week.`;
  }
}

/** One line shown under every block. */
export const OUTREACH_REMINDER = 'Check Do Not Call rules before you phone.';
/** The same line with the storm-sales clause. Shown only under storm records. */
export const STORM_REMINDER = "Check Do Not Call rules before you phone, and your state's rules on storm-related sales.";

export const NOTE_KINDS: NoteKind[] = [
  'sub-to-contractor',
  'trade-to-owner',
  'seller-to-new-business',
  'service-to-inspected',
  'supplier-to-awardee',
  'bidder-to-buyer',
  'door-hanger-storm',
  'door-hanger',
];
