import { isStageNote } from './stage';

/**
 * Round 19 coverage (review P2-F): a note a probation source leaves on its scan_runs row when it worked but the owner must know something
 * (a full page of rows: older rows in the window were not read). Like a stage-query note it is NOT a failure: the source-state rules, the
 * owner monitor and the health email read it as a note (isRunNote), and GET /api/admin/sources shows it as the check state `row_cap`.
 */
export const PROBATION_NOTE_PREFIX = 'probation note:';

export const isProbationNote = (e: unknown): boolean => typeof e === 'string' && e.trim().toLowerCase().startsWith(PROBATION_NOTE_PREFIX);

/** A scan_runs.error value that is a note, not a failure: a stage-query note or a probation note. */
export const isRunNote = (e: unknown): boolean => isStageNote(e) || isProbationNote(e);
