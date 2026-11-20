// r10: the app wears the website's brand. Reads src/styles.css, so a token change that breaks contrast fails here.
// PRINT_CONTRAST=1 npx vitest run tests/brand.test.ts prints the table that goes in the r10 APP report.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobile = path.join(here, '..');
const css = readFileSync(path.join(mobile, 'src', 'styles.css'), 'utf8');
const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
const tokens: Record<string, string> = {};
for (const m of root.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6});/gi)) tokens[m[1]] = m[2].toLowerCase();

function hex(v: string): string {
  return v.startsWith('#') ? v : tokens[v];
}
function lum(h: string): number {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function ratio(a: string, b: string): number {
  const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Every text or meaningful non-text colour on every background it sits on in the app. min: 4.5 text, 3 large text and non-text. */
export const PAIRS: Array<{ fg: string; bg: string; min: number; where: string }> = [
  // Text on light surfaces
  ...['background', 'surface', 'sand'].flatMap((bg) => [
    { fg: 'ink', bg, min: 4.5, where: 'body text, titles, settings rows, info notice' },
    { fg: 'muted', bg, min: 4.5, where: 'secondary text, meta, intent label, tab labels, hints' },
    { fg: 'brand-text', bg, min: 4.5, where: 'links, link buttons, ghost buttons, section eyebrows' },
    { fg: 'danger-ink', bg, min: 4.5, where: 'field errors, danger button text' },
  ]),
  // Filled controls
  { fg: 'on-brand', bg: 'brand', min: 4.5, where: 'primary button, picked trade chip, chosen feedback button' },
  { fg: 'on-brand', bg: 'brand-deep', min: 4.5, where: 'primary button pressed' },
  { fg: 'on-brand', bg: 'ink', min: 4.5, where: 'dark button' },
  { fg: '#ffffff', bg: '#000000', min: 4.5, where: 'Sign in with Apple' },
  { fg: 'ink', bg: 'signal', min: 3, where: 'logo tile arcs (graphic)' },
  // Record family tags
  { fg: 'storm-ink', bg: 'sky', min: 4.5, where: 'weather tag' },
  { fg: 'sage-ink', bg: 'sage', min: 4.5, where: 'permit tag' },
  { fg: 'civic-ink', bg: 'civic', min: 4.5, where: '311 and code tag' },
  // Notices
  { fg: 'success-ink', bg: 'success-soft', min: 4.5, where: 'success notice' },
  { fg: 'warn-ink', bg: 'warn-soft', min: 4.5, where: 'warn notice' },
  { fg: 'danger-ink', bg: 'danger-soft', min: 4.5, where: 'danger notice' },
  // Non-text: control edges, states, rings (WCAG 1.4.11)
  ...['background', 'surface', 'sand'].map((bg) => ({ fg: 'line-strong', bg, min: 3, where: 'input, chip, secondary button edges; switch off' })),
  { fg: 'brand', bg: 'surface', min: 3, where: 'switch on, picked plan edge, active tab icon' },
  { fg: 'brand-text', bg: 'sage', min: 3, where: 'pressed thumb icon' },
  { fg: 'danger', bg: 'surface', min: 3, where: 'danger button edge, invalid input edge' },
  ...['background', 'surface', 'sand'].map((bg) => ({ fg: 'ink', bg, min: 3, where: 'focus ring' })),
];

describe('brand tokens', () => {
  it('match the website values', () => {
    expect(tokens).toMatchObject({
      background: '#f5f4ef', surface: '#ffffff', sand: '#eceae2', ink: '#14201a', muted: '#5b635d', line: '#dedcd2', 'line-strong': '#7c847e',
      brand: '#1e3a2c', 'brand-deep': '#14291e', 'brand-text': '#2e5a41', 'on-brand': '#f5f4ef', signal: '#d9f046',
      sky: '#dde8ec', 'storm-ink': '#1f4a63', sage: '#e3efe6', 'sage-ink': '#24513a', civic: '#efeaf7', 'civic-ink': '#5b3f86',
    });
  });
  it('drop the old orange, warm paper and fonts', () => {
    expect(css).not.toMatch(/e8590c|ad4205|faf6ee|faf8f3|fbe8d8|fraunces|geist|--accent/i);
  });
  it('never use signal as text or an edge on a light surface', () => {
    const uses = [...css.matchAll(/([a-z-]+):[^;]*var\(--signal\)/g)].map((m) => m[1]);
    expect(uses.every((p) => p === 'background')).toBe(true);
  });
  it('fonts come from the installed packages, nothing from Google', () => {
    expect(css).toMatch(/node_modules\/@fontsource\/barlow-condensed\/files\/barlow-condensed-latin-700-normal\.woff2/);
    expect(css).toMatch(/node_modules\/@fontsource-variable\/inter\/files\/inter-latin-wght-normal\.woff2/);
    expect(css).toMatch(/node_modules\/@fontsource-variable\/jetbrains-mono\/files\/jetbrains-mono-latin-wght-normal\.woff2/);
    expect(css).not.toMatch(/googleapis|gstatic/);
  });
  it('keep 44 px tap targets', () => {
    expect(css).toMatch(/--tap: 44px;/);
  });
  it('every text and background pair the app uses passes AA', () => {
    const rows = PAIRS.map((p) => ({ ...p, r: ratio(p.fg, p.bg) }));
    if (process.env.PRINT_CONTRAST) {
      const name = (v: string) => (v.startsWith('#') ? v : `${v} ${tokens[v]}`);
      console.log(['| Foreground | Background | Ratio | Needs | Pass | Where |', '|---|---|---|---|---|---|',
        ...rows.map((x) => `| ${name(x.fg)} | ${name(x.bg)} | ${x.r.toFixed(2)}:1 | ${x.min}:1 | ${x.r >= x.min ? 'yes' : 'NO'} | ${x.where} |`)].join('\n'));
    }
    for (const x of rows) expect(x.r, `${x.fg} on ${x.bg}`).toBeGreaterThanOrEqual(x.min);
  });
});
