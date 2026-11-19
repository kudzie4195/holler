// The one place the AI step imports MATCH's rematch (contract in /home/claude/gates/r7/CONTEXT.md):
//   rematchSignals(db, signalIds: number[]): Promise<{ created: number }>
// Kept in its own file so tests can mock it without loading lib/signals.
export { rematchSignals } from '@/lib/signals/rematch';
