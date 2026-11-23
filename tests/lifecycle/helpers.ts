import { copyStats, bannedHits, hasEmDash } from '../seo/helpers/copy-metrics';
import {
  renderWelcomeMatches,
  renderWelcomeQuiet,
  renderTrialEnding,
  renderTrialEnded,
  type AlertItem,
} from '@/lib/lifecycle/templates';

export const BASE = 'https://localholler.com';
const common = (name = 'Peachtree Roofing') => ({
  businessName: name,
  feedUrl: `${BASE}/app`,
  plansUrl: `${BASE}/app/settings#billing-h`,
  unsubscribeUrl: `${BASE}/api/cron/lifecycle/unsubscribe?t=abc.def`,
});

export const ITEMS: AlertItem[] = [
  { title: 'Hail report: 1.25 inch hail near Marietta', city: 'Marietta', state: 'GA', occurredAt: '2026-11-17T18:20:00Z', kind: 'report', source: 'spc', subtype: null, severity: 3 },
  { title: 'Residential re-roof permit, 2300 sq ft, Roswell Rd', city: 'Atlanta', state: 'GA', occurredAt: '2026-11-18T14:05:00Z', kind: 'permit', source: 'atlanta-permits', subtype: 'permit', severity: 2 },
  { title: 'Storm damage 311 request: tree on roof', city: 'Decatur', state: 'GA', occurredAt: '2026-11-16T09:40:00Z', kind: 'civic', source: 'atlanta-311', subtype: '311', severity: 2 },
  { title: 'Severe thunderstorm warning for Cobb County', city: 'Marietta', state: 'GA', occurredAt: '2026-11-15T22:10:00Z', kind: 'alert', source: 'nws', subtype: null, severity: 3 },
  { title: 'Roof replacement permit, commercial', city: 'Smyrna', state: 'GA', occurredAt: '2026-11-14T11:00:00Z', kind: 'permit', source: 'smyrna-permits', subtype: 'permit', severity: 1 },
  { title: 'Open federal bid: roof repair at a Dobbins facility', city: 'Marietta', state: 'GA', occurredAt: '2026-11-13T08:00:00Z', kind: 'contract', source: 'sam-gov', subtype: null, severity: 1 },
];

export function samples() {
  return {
    'welcome matches (5 shown of 12)': renderWelcomeMatches({ ...common(), total: 12, items: ITEMS.slice(0, 5) }),
    'welcome matches (3 of 3)': renderWelcomeMatches({ ...common('Delgado HVAC'), total: 3, items: ITEMS.slice(0, 3) }),
    'welcome matches (1 of 1)': renderWelcomeMatches({ ...common('Smith Tree Care'), total: 1, items: ITEMS.slice(0, 1) }),
    'welcome quiet': renderWelcomeQuiet({
      ...common('Cobb Plumbing Co'),
      total: 34,
      days: 90,
      lines: [
        { label: 'building permits', count: 19 },
        { label: '311 requests', count: 8 },
        { label: 'storm reports', count: 5 },
        { label: 'code violations', count: 2 },
      ],
    }),
    'welcome quiet (one line)': renderWelcomeQuiet({ ...common('Cobb Plumbing Co'), total: 1, days: 90, lines: [{ label: 'weather alert', count: 1 }] }),
    'trial_ending with alerts': renderTrialEnding({ ...common(), items: [ITEMS[0], ITEMS[3], ITEMS[1]] }),
    'trial_ending without alerts': renderTrialEnding({ ...common('Delgado HVAC'), items: [] }),
    'trial_ended missed': renderTrialEnded({ ...common(), missed: 7 }),
    'trial_ended paused only': renderTrialEnded({ ...common('Smith Tree Care'), missed: 0 }),
  } as const;
}

// Port of /home/claude/gates/deslop_metrics.py (HTML to text, split on . ! ?, sentences of 3+ words).
export function pyText(h: string): string {
  let t = h.replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  t = t.replace(/<br\s*\/?>|<\/(p|li|h[1-6]|div|section|td|th|dt|dd|button|a|span)>/gi, '. ');
  t = t.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return t.replace(/\s+/g, ' ');
}
export function pyMetrics(h: string) {
  const t = pyText(h);
  const counts = t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(/\s+/).length)
    .filter((c) => c >= 3);
  const n = counts.length;
  const mean = counts.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(counts.reduce((a, c) => a + (c - mean) ** 2, 0) / n);
  return { n, mean, burstiness: sd / mean, pctUnder8: (100 * counts.filter((c) => c < 8).length) / n };
}
export { copyStats, bannedHits, hasEmDash };
