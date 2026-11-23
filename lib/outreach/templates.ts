/**
 * First-contact notes for the "Who to contact" block. Static text, no AI. Each is 40 to 80 words once filled in, uses the
 * placeholders [your name], [your business] and [your phone] for the member to replace, makes no claim about damage the sender has
 * not seen, uses no pressure, and says "public record" only where it is natural.
 */
import { t, type Lang } from '@/lib/i18n';

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

/**
 * The note for a situation, in the member's language. The wording lives in the dictionary (lib/i18n, keys note.*); the English notes are
 * the same words as before this file read them from there (tests/outreach/templates.test.ts). The greeting words are the dictionary's too,
 * so `vars.greeting` stays 'Property owner' or 'Current resident' whatever the language.
 */
export function renderNote(kind: NoteKind, vars: NoteVars = {}, lang: Lang = 'en'): string {
  const org = clean(vars.org);
  const address = clean(vars.address);
  const at = address ? t(lang, 'note.at', { address }) : t(lang, 'note.near_me');
  const greeting = t(lang, (vars.greeting ?? 'Property owner') === 'Current resident' ? 'note.greeting.resident' : 'note.greeting.owner');
  return t(lang, `note.${kind}`, {
    orgTeam: org ? t(lang, 'note.org_team', { org }) : '',
    org: org ? t(lang, 'note.org', { org }) : '',
    at,
    greeting,
  });
}

/** One line shown under every block. */
export const OUTREACH_REMINDER = 'Check Do Not Call rules before you phone.';
/** The same line with the storm-sales clause. Shown only under storm records. */
export const STORM_REMINDER = "Check Do Not Call rules before you phone, and your state's rules on storm-related sales.";

/** The reminder line in a language (the English constants above are the 'en' text). */
export function reminderFor(storm: boolean, lang: Lang = 'en'): string {
  return t(lang, storm ? 'outreach.reminder_storm' : 'outreach.reminder');
}

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
