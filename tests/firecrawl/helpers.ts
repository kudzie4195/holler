import { readFileSync } from 'node:fs';
import path from 'node:path';

export const fixturePath = (id: string, ext: 'page.md' | 'extracted.json') => path.resolve(__dirname, 'fixtures', `${id}.${ext}`);
export const pageMd = (id: string): string => readFileSync(fixturePath(id, 'page.md'), 'utf8');
export const extracted = (id: string): { solicitations: Array<Record<string, string>> } => JSON.parse(readFileSync(fixturePath(id, 'extracted.json'), 'utf8'));

/** Snapshot times: the Gwinnett and Rockdale pages were read live on 2026-11-22; the Dunwoody table is a Feb-Mar 2026 snapshot; Tucker's newest closing date is Aug 31 2026. */
export const NOW_LIVE = new Date('2026-11-22T17:00:00Z');
export const NOW_DUNWOODY_SNAPSHOT = new Date('2026-02-20T17:00:00Z');
export const NOW_TUCKER_SNAPSHOT = new Date('2026-06-01T12:00:00Z');
