// Reads for integration (feed and digest). Deliberately light: nothing here imports the `ai` SDK, so a page that ranks or shows
// notes never loads model code. The cron step lives in ./classify and ./budget.
export { notesFor, scoresFor, rankSignals, RANK_WEIGHTS, UNKNOWN_CONFIDENCE } from './rank';
export { NOTE_MAX_CHARS } from './note-rules';
