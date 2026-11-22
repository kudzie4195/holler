import type { CategoryId } from './categories';

/**
 * Construction stage of a building permit (PLAN-2.0 item 2.1). Pure and client-safe: no server imports, no clock, no network.
 *
 * A permit portal that publishes a status column lets Holler see a permit move from "issued" to "final inspection", "finaled" or
 * "certificate of occupancy". For the trades that work on a FINISHED building (cleaning, landscaping, security) that is a timing
 * signal: the building may be ready soon. It is never a request for work and never says a vendor is chosen.
 *
 * The status text of a portal is read ONLY through permitStageOf: the stored value is one of the fixed codes below, never the portal's
 * own words, so nothing free-typed reaches a row or a card.
 */
export type PermitStage = 'issued' | 'final_inspection' | 'finaled' | 'certificate_of_occupancy' | 'stopped';

export const PERMIT_STAGES: readonly PermitStage[] = ['issued', 'final_inspection', 'finaled', 'certificate_of_occupancy', 'stopped'];

/** Stages that start a "coming soon" update for the stage trades. "stopped" (expired, cancelled, withdrawn) is recorded but never an update. */
export const TRIGGER_STAGES: readonly PermitStage[] = ['final_inspection', 'finaled', 'certificate_of_occupancy'];

export function isPermitStage(v: unknown): v is PermitStage {
  return typeof v === 'string' && (PERMIT_STAGES as readonly string[]).includes(v);
}

export function isTriggerStage(v: unknown): v is PermitStage {
  return typeof v === 'string' && (TRIGGER_STAGES as readonly string[]).includes(v);
}

/**
 * Trades that get the stage update: cleaners (house and commercial), landscapers and security. Whether a given permit reaches a given
 * trade is still decided by the existing routing (lib/signals/permit-routing.ts: a new building reaches landscaping, cleaning and
 * security, a remodel reaches cleaning, a tenant fit-out reaches commercial cleaning and security), so a re-roof reaches none of them.
 */
export const STAGE_TRADES: readonly CategoryId[] = ['cleaning', 'janitorial-commercial', 'landscaping', 'security'];

export function isStageTrade(trade: string | null | undefined): boolean {
  return typeof trade === 'string' && (STAGE_TRADES as readonly string[]).includes(trade);
}

const NEGATIVE_RE = /\b(?:fail(?:ed|ure)?|denied|reject(?:ed)?|not|no)\b|\bincomplete\b|\bnon[\s-]?compliant\b/;
const STOPPED_RE = /\b(?:expired|cancell?ed|withdrawn|revoked|void(?:ed)?|suspended|denied|rejected|abandoned)\b/;
const CO_RE = /\bcertificate\s+of\s+occupancy\b|\bc\s?of\s?o\b|\bc\.?o\.?\s+(?:issued|approved|granted)\b|\b(?:temporary|temp)\s+c\.?o\b|\btco\b/;
const FINALED_RE = /\bfinal(?:ed|led|ized)\b|\bclosed\s*[-:]?\s*final\b|\bpermit\s+final\b|^\s*final\s*$|\bwork\s+complete(?:d)?\b|^\s*complete(?:d)?\s*$|\bproject\s+complete(?:d)?\b/;
const FINAL_INSPECTION_RE = /\bfinal\s+(?:inspection|insp)\b|\bready\s+for\s+final\b|\bfinal\s+(?:pending|scheduled|requested)\b/;
const ISSUED_RE = /^\s*(?:permit\s+)?issued\s*$|^\s*(?:active|approved|reinstated|open)\s*$|\bpermit\s+issued\b/;

/**
 * One of the fixed stage codes for a portal's status text, or null when the text is empty, a field label ("Issued Status Code" on the
 * DeKalb layer) or a status this table does not know. A negative word (failed, denied, not, incomplete) next to "final" never gives a
 * trigger stage. Order matters: certificate of occupancy, stopped, final inspection, finaled, issued.
 */
export function permitStageOf(raw: unknown): PermitStage | null {
  if (typeof raw !== 'string') return null;
  const t = raw.toLowerCase().replace(/[_/]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 80) return null;
  if (/\bstatus code\b/.test(t)) return null;
  if (CO_RE.test(t) && !NEGATIVE_RE.test(t)) return 'certificate_of_occupancy';
  if (STOPPED_RE.test(t)) return 'stopped';
  if (/\bfinal\b|\bfinaled\b|\bcomplete/.test(t) && NEGATIVE_RE.test(t)) return null;
  if (FINAL_INSPECTION_RE.test(t)) return 'final_inspection';
  if (FINALED_RE.test(t)) return 'finaled';
  if (ISSUED_RE.test(t)) return 'issued';
  return null;
}

// ---- the card line ------------------------------------------------------------------------------------------------------------------

/**
 * One fixed sentence per trigger stage. Timing only: it says what the public source lists and that the building may be ready soon.
 * It never says work is needed, that a hire happened or that anyone is choosing a vendor. At most 130 characters with the date.
 */
const STAGE_TEXT: Readonly<Record<PermitStage, string | null>> = {
  issued: null,
  stopped: null,
  final_inspection: 'The public source lists this permit at final inspection ({date}). The building may be ready soon.',
  finaled: 'The public source lists this permit as finished ({date}). The building may be ready soon.',
  certificate_of_occupancy: 'The public source lists a certificate of occupancy ({date}). The building may open soon.',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 22, 2026" (UTC day) for an ISO instant, or null. */
function dayText(iso: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/**
 * The card line for a stored stage (data.permitStage) and the day Holler first saw it (data.permitStageAt), or null for no stage, a stage
 * that is not a trigger, or a value this code does not know (a hand-edited row never prints free text). Without a date it reads "on record".
 */
export function stageLine(stage: unknown, seenAt?: string | null): string | null {
  if (!isPermitStage(stage)) return null;
  const text = STAGE_TEXT[stage];
  if (!text) return null;
  return text.replace('{date}', dayText(seenAt) ? `seen ${dayText(seenAt)}` : 'on record');
}

/** Every string stageLine can print, for the wording tests. */
export function allStageStrings(): string[] {
  return PERMIT_STAGES.map((s) => stageLine(s, '2026-11-22T12:00:00Z')).filter((x): x is string => x !== null);
}

/** PostgREST select aliases for the two data keys a stage update writes (the pattern of DEADLINE_SELECT and VALUE_SELECT). */
export const STAGE_SELECT = 'permitStage:data->>permitStage,permitStageAt:data->>permitStageAt';
