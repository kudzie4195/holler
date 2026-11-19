// Round 9 design tokens: the contract in gates/r9/CONTEXT.md, the removed old look, and a WCAG contrast table for every
// text/background pair the system allows. Contrast is computed here with the WCAG 2.x relative-luminance formula.
//
// The removed-token scan covers the whole web tree by default: every source file under app/, components/ and lib/ (lib/legal/
// and the email templates included), plus the icon and package.json. No switch to remember. Import scanRemoved() to scan your own list.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('../../', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, ROOT), 'utf8');

/** All `--color-*: #hex` values in the @theme block of app/globals.css, lower-cased. */
export function themeColors(css = read('app/globals.css')): Record<string, string> {
  const theme = css.match(/@theme\s*{([\s\S]*?)\n}/)![1];
  return Object.fromEntries([...theme.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2].toLowerCase()]));
}

function lum(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The contract (gates/r9/CONTEXT.md "Design tokens"). line-strong is A's computed value. */
export const CONTRACT: Record<string, string> = {
  background: '#f5f4ef',
  surface: '#ffffff',
  sand: '#eceae2',
  ink: '#14201a',
  muted: '#5b635d',
  line: '#dedcd2',
  'line-strong': '#7c847e',
  brand: '#1e3a2c',
  'brand-deep': '#14291e',
  'brand-raised': '#24443a',
  'brand-line': '#6e8c79',
  'brand-text': '#2e5a41',
  'on-brand': '#f5f4ef',
  'on-brand-muted': '#c9d6cd',
  'on-brand-faint': '#a9bdb0',
  signal: '#d9f046',
  sky: '#dde8ec',
  storm: '#4c7fa6',
  'storm-ink': '#1f4a63',
  sage: '#e3efe6',
  'sage-mark': '#3f8a5c',
  'sage-ink': '#24513a',
  civic: '#efeaf7',
  'civic-mark': '#8a68bf',
  'civic-ink': '#5b3f86',
  'permit-on-brand': '#6fb38a',
  'civic-on-brand': '#c9a8f0',
  'weather-on-brand': '#8fbbd9',
  success: '#2f8f5b',
  'success-ink': '#1f6b41',
  'success-soft': '#e2f1e8',
  warn: '#b7791f',
  'warn-ink': '#7a5410',
  'warn-soft': '#fbf0d5',
  danger: '#c53030',
  'danger-soft': '#fbe5e5',
};

const FAMILY: Record<string, 'weather' | 'permits' | 'civic'> = {
  alert: 'weather',
  report: 'weather',
  disaster: 'weather',
  quake: 'weather',
  permit: 'permits',
  contract: 'permits',
  civic: 'civic',
  ask: 'civic',
  event: 'civic',
  travel: 'civic',
};
const FAMILY_TOKENS = {
  weather: { bg: 'sky', fg: 'storm-ink' },
  permits: { bg: 'sage', fg: 'sage-ink' },
  civic: { bg: 'civic', fg: 'civic-ink' },
} as const;

/** Patterns of the old look that must not come back. */
export const REMOVED: { name: string; re: RegExp }[] = [
  { name: 'accent token', re: /--color-accent|(?<![\w-])(?:[\w[\]&/-]+:)*(?:bg|text|border|ring|outline|from|to|via|fill|stroke|decoration|divide|placeholder|caret|shadow|border-l)-accent(?:-(?:hover|bright|text|soft))?(?![\w-])/ },
  { name: 'accent tone', re: /tone(?:=|:\s*)["']accent["']/ },
  { name: 'brick token', re: /--color-brick|(?<![\w-])(?:bg|text|border|fill|stroke)-brick(?![\w-])/ },
  {
    name: 'old hex',
    re: /#(?:e8590c|ad4205|fbe8d8|faf6ee|fffdf9|191714|5c574f|e5dccb|f3ebdd|8f8572|c94a08|e15509|c98a6b|8f3705|e7ede3|3b5a40|4f7d55|2f6f8f|d4e3cd)(?![0-9a-f])/i,
  },
  { name: 'warm shadow or orange rgb', re: /rgb\(\s*(?:74[ ,]+52[ ,]+24|232[ ,]+89[ ,]+12)\b/ },
  { name: 'Fraunces', re: /fraunces/i },
  { name: 'Geist', re: /\bgeist\b/i },
  { name: 'Google Fonts', re: /fonts\.(?:googleapis|gstatic)\.com/ },
  // The dead warm-paper hero backdrop (review 1 P1-3). Deleted from globals.css; must not come back.
  { name: 'hero-paper', re: /hero-paper/ },
];

/** Unit A's files (gates/r9/CONTEXT.md "Units and ownership"). */
export const UNIT_A_FILES = [
  'app/globals.css',
  'app/layout.tsx',
  'app/global-error.tsx',
  ...['logo', 'button', 'input', 'select', 'field', 'card', 'badge', 'chip', 'notice', 'slider', 'empty-state', 'password-input', 'top-nav', 'footer', 'app-nav', 'auth-card', 'doc-page'].map((f) => `components/${f}.tsx`),
  'components/signal-meta.ts',
  'components/icons/index.tsx',
  'public/icon.svg',
  'package.json',
];

function walk(dir: string): string[] {
  return readdirSync(new URL(dir, ROOT)).flatMap((n) => {
    const rel = `${dir}/${n}`;
    return statSync(new URL(rel, ROOT)).isDirectory() ? walk(rel) : /\.(ts|tsx|css|svg)$/.test(n) ? [rel] : [];
  });
}

/** Every line in `files` that matches a removed pattern, as "file:line name". */
export function scanRemoved(files: string[]): string[] {
  return files.flatMap((f) =>
    read(f)
      .split('\n')
      .flatMap((line, i) => REMOVED.filter((r) => r.re.test(line)).map((r) => `${f}:${i + 1} ${r.name}`)),
  );
}

/** The whole web tree, always. UNIT_A_FILES adds the two files outside app/, components/ and lib/. */
export const SCAN_ROOTS = ['app', 'components', 'lib'];
const scanFiles = [...new Set([...SCAN_ROOTS.flatMap(walk), ...UNIT_A_FILES])];

const C = themeColors();
const t = (name: string) => {
  const v = C[name];
  if (!v) throw new Error(`missing token ${name}`);
  return v;
};

type Pair = { use: string; fg: string; bg: string; min: 4.5 | 3 };
const text = (use: string, fg: string, bg: string): Pair => ({ use, fg, bg, min: 4.5 });
const edge = (use: string, fg: string, bg: string): Pair => ({ use, fg, bg, min: 3 });

const LIGHT = ['background', 'surface', 'sand'];
const GREEN = ['brand', 'brand-deep', 'brand-raised', 'ink'];

export const PAIRS: Pair[] = [
  // Body text on light.
  ...LIGHT.flatMap((bg) => [text('body', 'ink', bg), text('secondary text', 'muted', bg), text('green link', 'brand-text', bg), text('eyebrow on light', 'brand-text', bg), text('error text', 'danger', bg)]),
  text('muted on a family band', 'muted', 'sky'),
  text('muted on a family band', 'muted', 'sage'),
  text('muted on a family band', 'muted', 'civic'),
  // Text on green and ink.
  ...GREEN.flatMap((bg) => [text('text on green', 'on-brand', bg), text('secondary on green', 'on-brand-muted', bg), text('tertiary on green', 'on-brand-faint', bg)]),
  text('eyebrow on green', 'signal', 'brand'),
  text('eyebrow on ink (footer titles)', 'signal', 'ink'),
  // Buttons.
  text('button primary', 'on-brand', 'brand'),
  text('button primary hover', 'on-brand', 'brand-raised'),
  text('button primary pressed', 'on-brand', 'brand-deep'),
  text('button signal', 'ink', 'signal'),
  text('button signal hover', 'ink', 'signal-hover'),
  edge('button signal hover fill on green', 'signal-hover', 'brand'),
  text('button secondary', 'ink', 'surface'),
  text('button secondary hover', 'ink', 'sand'),
  text('button ghost on light', 'ink', 'background'),
  text('button ghost on green', 'on-brand', 'brand'),
  text('button outline-signal', 'on-brand', 'brand'),
  text('button outline-signal on ink', 'on-brand', 'ink'),
  text('button outline-signal hover', 'ink', 'signal'),
  edge('button outline-signal edge', 'signal', 'brand'),
  edge('button secondary edge', 'line-strong', 'surface'),
  text('chip selected', 'on-brand', 'brand'),
  // Badges (family tags) and status tags.
  text('badge weather', 'storm-ink', 'sky'),
  text('badge permits', 'sage-ink', 'sage'),
  text('badge 311 and civic', 'civic-ink', 'civic'),
  ...Object.entries(FAMILY).map(([k]) => text(`badge kind ${k}`, `kind-${k}-fg`, `kind-${k}-bg`)),
  text('status neutral', 'muted', 'sand'),
  text('status brand', 'brand-text', 'sage'),
  text('status success', 'success-ink', 'success-soft'),
  text('status warn', 'warn-ink', 'warn-soft'),
  text('status danger', 'danger', 'danger-soft'),
  // Placeholders.
  text('placeholder on light input', 'muted', 'surface'),
  text('placeholder on green input', 'on-brand-faint', 'brand-deep'),
  // Focus ring, every surface.
  ...[...LIGHT, 'sky', 'sage', 'civic'].map((bg) => edge('focus ring on light', 'ink', bg)),
  ...GREEN.map((bg) => edge('focus ring on green', 'signal', bg)),
  // Control edges.
  ...LIGHT.map((bg) => edge('form control edge (line-strong)', 'line-strong', bg)),
  edge('control edge on green (brand-line)', 'brand-line', 'brand'),
  edge('control edge on green (brand-line)', 'brand-line', 'brand-deep'),
  // Family marks: on light (dots and stripes) and on green (the map).
  ...LIGHT.flatMap((bg) => [edge('weather mark', 'storm', bg), edge('permit mark', 'sage-mark', bg), edge('civic mark', 'civic-mark', bg)]),
  ...['brand', 'brand-raised'].flatMap((bg) => [
    edge('permit mark on green', 'permit-on-brand', bg),
    edge('civic mark on green', 'civic-on-brand', bg),
    edge('weather mark on green', 'weather-on-brand', bg),
  ]),
  // Slider: thumb and track on light.
  edge('slider thumb', 'brand', 'surface'),
  edge('slider track', 'line-strong', 'surface'),
];

describe('design tokens: the contract', () => {
  it('every contract token exists in @theme with the agreed value', () => {
    const wrong = Object.entries(CONTRACT).filter(([k, v]) => C[k] !== v).map(([k, v]) => `${k}: want ${v}, got ${C[k] ?? 'missing'}`);
    expect(wrong).toEqual([]);
  });

  it('kind badge tokens map to their family tint and ink', () => {
    for (const [kind, fam] of Object.entries(FAMILY)) {
      expect(C[`kind-${kind}-bg`], kind).toBe(C[FAMILY_TOKENS[fam].bg]);
      expect(C[`kind-${kind}-fg`], kind).toBe(C[FAMILY_TOKENS[fam].fg]);
    }
  });

  it('fonts, radii and the shared classes are defined; no removed token is declared', () => {
    const css = read('app/globals.css');
    expect(css).toMatch(/--font-display: 'Barlow Condensed', 'Barlow Condensed Fallback'/);
    expect(css).toMatch(/--font-sans: 'Inter Variable'/);
    expect(css).toMatch(/--font-mono: 'JetBrains Mono Variable'/);
    expect(css).toMatch(/--radius-chip: 6px;/);
    expect(css).toMatch(/--radius-control: 10px;/);
    expect(css).toMatch(/--radius-card: 20px;/);
    expect(css).toMatch(/--text-xs: 0\.8125rem;/);
    for (const cls of ['.h-plain', '.eyebrow', '.on-brand', '.on-light', '.h-link', '.font-display', '.range-holler', '.skeleton']) {
      expect(css, cls).toContain(`${cls} {`);
    }
    for (const gone of ['accent', 'accent-hover', 'accent-bright', 'accent-text', 'accent-soft', 'brick']) expect(C[gone], gone).toBeUndefined();
  });

  it('the three fonts are read from the installed packages, never from Google', () => {
    const css = read('app/globals.css');
    for (const f of [
      '@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2',
      '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
      '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
    ]) {
      expect(css).toContain(`url('../node_modules/${f}')`);
    }
    expect(css).not.toMatch(/fonts\.googleapis|fonts\.gstatic/);
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).toEqual(expect.arrayContaining(['@fontsource/barlow-condensed', '@fontsource-variable/inter', '@fontsource-variable/jetbrains-mono']));
    expect(Object.keys(pkg.dependencies).filter((d) => /fraunces|geist/i.test(d))).toEqual([]);
  });
});

describe('design tokens: nothing of the old look remains', () => {
  it('no removed token, old hex, hero-paper, Fraunces or Geist anywhere in app/, components/ and lib/', () => {
    expect(scanRemoved(scanFiles)).toEqual([]);
  });

  it('the scan covers the whole tree, emails and legal text included', () => {
    for (const f of ['app/globals.css', 'components/footer.tsx', 'lib/legal/email-footer.ts', 'lib/email/templates.ts', 'lib/lifecycle/templates.ts']) {
      expect(scanFiles, f).toContain(f);
    }
    expect(scanFiles.length).toBeGreaterThan(300);
  });

  it('the scan itself catches each old pattern', () => {
    const samples = ['hero-paper', 'bg-accent', 'hover:text-accent-text', 'var(--color-accent-soft)', 'tone="accent"', 'border-brick', '#E8590C', '#faf6ee', 'rgb(74 52 24 / 0.05)', "'Fraunces Variable'", "from 'geist/font/sans'", 'https://fonts.googleapis.com/css2'];
    for (const s of samples) expect(REMOVED.some((r) => r.re.test(s)), s).toBe(true);
    for (const ok of ['accented', 'text-brand-text', 'bg-signal', 'kind-civic-bg']) expect(REMOVED.some((r) => r.re.test(ok)), ok).toBe(false);
  });
});

describe('design tokens: contrast table (WCAG 2.1 AA)', () => {
  const rows = PAIRS.map((p) => ({ ...p, ratio: contrast(t(p.fg), t(p.bg)) }));

  it('prints the table', () => {
    console.log(rows.map((r) => `${r.ratio.toFixed(2).padStart(5)}  ${r.min === 3 ? '3.0' : '4.5'}  ${r.fg} on ${r.bg}  (${r.use})`).join('\n'));
    expect(rows.length).toBeGreaterThan(80);
  });

  it('every allowed pair meets its threshold: 4.5:1 for text, 3:1 for control edges, marks and focus rings', () => {
    const fails = rows.filter((r) => r.ratio < r.min).map((r) => `${r.fg} on ${r.bg} ${r.ratio.toFixed(2)} < ${r.min} (${r.use})`);
    expect(fails).toEqual([]);
  });

  it('signal stays off light surfaces: it would fail as text or an edge there', () => {
    for (const bg of LIGHT) expect(contrast(t('signal'), t(bg))).toBeLessThan(3);
  });

  it('the decorative line token is below 3:1 on surface, which is why control edges use line-strong', () => {
    expect(contrast(t('line'), t('surface'))).toBeLessThan(3);
  });
});
