// r8 pass 2: plain labels on alert cards (mapped in the app by intent key; the server's INTENT_LABEL is unchanged) and the push screen title.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INTENT_LABEL } from '../../lib/signals/intent';
import { intentLabel } from '../src/ui/format';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (f: string) => readFileSync(path.join(here, '..', 'src', f), 'utf8');

describe('intent labels shown in the app', () => {
  it('maps the server labels to plain words by key', () => {
    expect(intentLabel({ key: 'demand', label: INTENT_LABEL.demand })).toBe('Might need work');
    expect(intentLabel({ key: 'spending', label: INTENT_LABEL.spending })).toBe('Money being spent');
    expect(intentLabel({ key: 'open-bid', label: INTENT_LABEL.spending })).toBe('Money being spent');
    expect(intentLabel({ key: 'new-business', label: INTENT_LABEL.spending })).toBe('Money being spent');
  });
  it('keeps the server label for asking and unknown keys', () => {
    expect(intentLabel({ key: 'asking', label: INTENT_LABEL.asking })).toBe('Someone asked');
    expect(intentLabel({ key: 'public-post', label: 'Someone asked' })).toBe('Someone asked');
    expect(intentLabel({ key: 'something-new', label: 'Server words' })).toBe('Server words');
  });
  it('the card renders the mapped label, never the raw server label', () => {
    const parts = src('screens/AlertParts.tsx');
    expect(parts).toMatch(/intentLabel\(item\.intent\)/);
    expect(parts).not.toMatch(/\{item\.intent\.label\}/);
  });
});

describe('push prompt', () => {
  it('says what a push is for, without promising work', () => {
    const screen = src('screens/PushPrompt.tsx');
    expect(screen).toMatch(/Get a push when a record matches/);
    expect(screen).not.toMatch(/Hear about new work first/);
  });
});

describe('tag row layout (r8 pass 3)', () => {
  const css = readFileSync(path.join(here, '..', 'src', 'styles.css'), 'utf8');
  it('spaces tag and label with a row gap, so a wrapped label starts at the text edge with no indent', () => {
    expect(css).toMatch(/\.tag-row \{[^}]*flex-wrap: wrap;[^}]*gap: 4px 8px;/);
    expect(css).toMatch(/\.intent \{[^}]*margin-left: 0;/);
  });
});
