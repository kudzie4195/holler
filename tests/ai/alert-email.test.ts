import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { renderAiSpendAlert } from '../../lib/ai/alert-email';
import { bannedHits, copyStats, hasEmDash } from '../seo/helpers/copy-metrics';
import { postalFooterText } from '../../lib/legal/email-footer';

describe('AI spend alert email', () => {
  for (const kind of ['alert_80', 'alert_100'] as const) {
    it(`${kind}: real figures, footer, copy rules`, () => {
      const m = renderAiSpendAlert({ kind, month: '2026-11-01', spentUsd: kind === 'alert_80' ? 8.1234 : 10.0012, capUsd: 10 });
      expect(m.text).toContain(postalFooterText());
      expect(m.html).toContain('ColorLabPro');
      expect(m.text).toContain('November 2026');
      expect(m.text).toContain('$10.00');
      if (kind === 'alert_80') expect(m.text).toContain('$8.12');
      if (kind === 'alert_80') expect(m.subject).toBe('Holler AI spend is at 81% of the monthly cap');
      const body = m.text.replace(postalFooterText(), '');
      expect(hasEmDash(m.text + m.html + m.subject)).toBe(false);
      expect(/[–]/.test(m.text)).toBe(false);
      expect(bannedHits(body)).toEqual([]);
      const st = copyStats(body);
      expect(st.cv, JSON.stringify(st)).toBeGreaterThanOrEqual(0.55);
      expect(st.shortShare, JSON.stringify(st)).toBeGreaterThanOrEqual(0.12);
      expect(st.mean, JSON.stringify(st)).toBeGreaterThanOrEqual(12);
      expect(st.mean, JSON.stringify(st)).toBeLessThanOrEqual(22);
      expect(m.html).not.toMatch(/<script/i);
    });
  }
});
