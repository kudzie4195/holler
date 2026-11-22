import type { CategoryId } from './categories';
import { localizeDate, t, type DictKey, type Lang } from '../i18n';

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

/**
 * Upper-case fragments for an adapter's stage query ($where upper(status) like '%FRAGMENT%'): a status that may read as final inspection,
 * finished or certificate of occupancy. Wide on purpose; permitStageOf makes the real decision per row, so "INCOMPLETE" is read and dropped.
 */
export const STAGE_STATUS_FRAGMENTS: readonly string[] = ['FINAL', 'COMPLET', 'CERTIFICATE', 'OCCUPANCY', 'C OF O', 'TCO', 'CO ISSUED', 'CO APPROVED'];

const NEGATIVE_RE = /\b(?:fail(?:ed|ure)?|denied|reject(?:ed)?|not|no)\b|\bincomplete\b|\bnon[\s-]?compliant\b/;
const STOPPED_RE = /\b(?:expired|cancell?ed|withdrawn|revoked|void(?:ed)?|suspended|denied|rejected|abandoned)\b/;
const CO_RE = /\bcertificate\s+of\s+occupancy\b|\bc\s?of\s?o\b|\bc\.?o\.?\s+(?:issued|approved|granted)\b|\b(?:temporary|temp)\s+c\.?o\b|\btco\b/;
const FINALED_RE = /\bfinal(?:ed|led|ized)\b|\bfinal\s+(?:approved|passed|accepted)\b|\bcertificate\s+of\s+completion\b|\bclosed\s*[-:]?\s*final\b|\bpermit\s+final\b|^\s*final\s*$|\bwork\s+complete(?:d)?\b|^\s*complete(?:d)?\s*$|\bproject\s+complete(?:d)?\b/;
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
 * One fixed sentence per trigger stage (dictionary keys stage.line.*, English and Spanish). Timing only: it says what the public source
 * lists and that the building may be ready soon. It never says work is needed, that a hire happened or that anyone is choosing a vendor.
 * At most 130 characters with the date.
 */
const STAGE_LINE_KEY: Readonly<Record<PermitStage, DictKey | null>> = {
  issued: null,
  stopped: null,
  final_inspection: 'stage.line.final_inspection',
  finaled: 'stage.line.finaled',
  certificate_of_occupancy: 'stage.line.certificate_of_occupancy',
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
export function stageLine(stage: unknown, seenAt?: string | null, lang: Lang = 'en'): string | null {
  if (!isPermitStage(stage)) return null;
  const key = STAGE_LINE_KEY[stage];
  if (!key) return null;
  const day = dayText(seenAt);
  return t(lang, key, { date: day ? t(lang, 'stage.date.seen', { date: localizeDate(day, lang) }) : t(lang, 'stage.date.on_record') });
}

/** Every string stageLine can print, for the wording tests. */
export function allStageStrings(lang: Lang = 'en'): string[] {
  return PERMIT_STAGES.map((s) => stageLine(s, '2026-11-22T12:00:00Z', lang)).filter((x): x is string => x !== null);
}

/** PostgREST select aliases for the data keys a stage update writes (the pattern of DEADLINE_SELECT and VALUE_SELECT). */
export const STAGE_SELECT = 'permitStage:data->>permitStage,permitStageAt:data->>permitStageAt,permitStageUpdate:data->>permitStageUpdate';

// ---- the switch -----------------------------------------------------------------------------------------------------------------------

/** Env flag for the stage QUERY and the stage updates it brings. OFF unless "1", "true", "on" or "yes" (any case). Read at call time. */
export const STAGE_UPDATES_FLAG = 'HOLLER_STAGE_UPDATES_ENABLED';
const ON = new Set(['1', 'true', 'on', 'yes']);
export function stageUpdatesEnabled(value: string | undefined = process.env[STAGE_UPDATES_FLAG]): boolean {
  return ON.has((value ?? '').trim().toLowerCase());
}

// ---- stage updates as their own kind of message --------------------------------------------------------------------------------

/** Order of the trigger stages: a LOWER stage never rewrites the card line of a higher one. */
export const STAGE_RANK: Readonly<Record<PermitStage, number>> = { issued: 0, stopped: 0, final_inspection: 1, finaled: 2, certificate_of_occupancy: 3 };

/** Most stage updates one member gets in a UTC day, counted together with the per-scan cap of 25 (lib/signals/match.ts MAX_MATCHES_PER_USER). */
export const MAX_STAGE_UPDATES_PER_MEMBER_PER_DAY = 5;

/** Short names for the email subject, the digest and the push (dictionary keys stage.name.*). */
const STAGE_NAME_KEY: Readonly<Record<PermitStage, DictKey | null>> = {
  issued: null,
  stopped: null,
  final_inspection: 'stage.name.final_inspection',
  finaled: 'stage.name.finaled',
  certificate_of_occupancy: 'stage.name.certificate_of_occupancy',
};

/**
 * A record row that carries a stage UPDATE (data.permitStageUpdate, written only when a stage change reached an already stored project):
 * its email and push say "Stage update" and use the date of the change, never "new" and never "N days ago".
 */
export function isStageUpdate(row: { permitStage?: unknown; permitStageAt?: unknown; permitStageUpdate?: unknown } | null | undefined): boolean {
  if (!row) return false;
  const flag = row.permitStageUpdate === true || row.permitStageUpdate === 'true';
  return flag && isTriggerStage(row.permitStage) && typeof row.permitStageAt === 'string' && Number.isFinite(Date.parse(row.permitStageAt));
}

/** "final inspection", "finished" or "certificate of occupancy" (Spanish: "inspección final", ...), or null for a stage that is not a trigger. */
export function stageName(stage: unknown, lang: Lang = 'en'): string | null {
  if (!isPermitStage(stage)) return null;
  const key = STAGE_NAME_KEY[stage];
  return key ? t(lang, key) : null;
}

/** The day of a stage date as the reader's language writes it ("Nov 22, 2026" / "22 nov 2026"), or null. */
export function stageDay(at: unknown, lang: Lang = 'en'): string | null {
  const day = typeof at === 'string' ? dayText(at) : null;
  return day ? localizeDate(day, lang) : null;
}

/** "Stage update: final inspection, listed by the public source on Nov 22, 2026." (null when this is not a stage update). */
export function stageUpdateLine(stage: unknown, at: unknown, lang: Lang = 'en'): string | null {
  const name = stageName(stage, lang);
  const day = stageDay(at, lang);
  return name && day ? t(lang, 'stage.update.line', { name, date: day }) : null;
}

/** The time part of a stage update's meta line: "Stage update, Nov 22, 2026" (null without a valid date). */
export function stageUpdateMeta(at: unknown, lang: Lang = 'en'): string | null {
  const day = stageDay(at, lang);
  return day ? t(lang, 'stage.update.meta', { date: day }) : null;
}

/** Email subject for one stage update: "Update: final inspection on a permit near you". */
export function stageUpdateSubject(stage: unknown, lang: Lang = 'en'): string | null {
  const name = stageName(stage, lang);
  return name ? t(lang, 'stage.update.subject', { name }) : null;
}

/** Every string a stage update (email subject, line, meta) and its push can print, for the wording tests. */
export function allStageUpdateStrings(lang: Lang = 'en'): string[] {
  const at = '2026-11-22T12:00:00Z';
  const out: Array<string | null> = [];
  for (const s of TRIGGER_STAGES) {
    out.push(stageUpdateLine(s, at, lang), stageUpdateSubject(s, lang), stageUpdateMeta(at, lang));
  }
  out.push(t(lang, 'stage.update.subject_fallback'), t(lang, 'stage.update.subject_only', { n: 2 }), t(lang, 'stage.update.subject_mixed', { n: 3, u: 2 }));
  return out.filter((x): x is string => x !== null);
}

/** The scan note written to holler_scan_runs.error when a source's stage query did not work. Not a failure of the source itself. */
export const STAGE_NOTE_PREFIX = 'stage query:';
export const isStageNote = (e: unknown): boolean => typeof e === 'string' && e.trim().toLowerCase().startsWith(STAGE_NOTE_PREFIX);
