/* eslint-disable @typescript-eslint/no-explicit-any */
// Round 18 ROUTES review 2 probe (logs/REV2-ROUTES-probe-tests), kept as a permanent regression test (redo 2).
// REV2-ROUTES probe H: what a junk-removal member is told about an alteration whose description mentions demolition (fix H + the new
// label rule soon-interior-demolition-hauling). Copy to tests/_rev2/ in a clone at d93f95d; npx vitest run tests/_rev2/h-interior-demo-wording.test.ts
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { classifyPermit } from '@/lib/signals/mapping/permit';
import { labelFor, ruleFor } from '@/lib/signals/lead-rules';
import { briefFor } from '@/lib/signals/brief';
import { renderDigest, type DigestItem } from '@/lib/email/templates';

const NOW = new Date('2026-11-22T12:00:00Z');
const cases: Array<[string[], string, string]> = [
  [['Commercial Alteration'], 'interior demolition of office suite', 'arcgis-atlanta-permits'],
  [['Building Combo Permit', 'Alter Commercial'], 'soft demo for tenant improvement', 'socrata-cincinnati-permits'], // the real row 134445 shape
  [['Existing Bldg - Remodel Only (C)', 'Commercial'], 'demo interior partitions', 'socrata-batonrouge-permits'],
];
describe('REV2-ROUTES H: interior demolition inside a commercial alteration, junk-removal member', () => {
  for (const [structured, free, source] of cases) {
    it(`${structured.join(' | ')} + "${free}"`, () => {
      const c = classifyPermit({ structured, free: [free] }, 'Atlanta');
      const title = `${c.label} permit in Atlanta`;
      const sig = { source, kind: 'permit', subtype: 'permit', title, summary: `${structured.join(' | ')} | 100 MAIN ST` };
      const label = labelFor(sig, 'junk-removal');
      const rule = ruleFor(sig, 'junk-removal')?.id;
      const brief = briefFor({ ...sig, label: label as any, trade: 'junk-removal' });
      const mail = (lang: 'en' | 'es') => renderDigest({ businessName: 'Acme Hauling', items: [{ kind: 'permit', source, subtype: 'permit', title, summary: sig.summary, place: 'Atlanta, GA', occurredAt: NOW.toISOString(), sourceUrl: 'https://example.org', label, trade: 'junk-removal', deadline: null, bidLine: null } as DigestItem], totalCount: 1, appUrl: 'https://x.test/app', unsubscribeUrl: 'https://x.test/u', now: NOW, lang } as never).text;
      const en = mail('en'), es = mail('es');
      console.log(`title "${title}" tags ${JSON.stringify(c.categories)} -> junk-removal ${label} [${rule}]\n  why: ${brief.why}\n  email (en) says demolition permit: ${/demolition permit/i.test(en)}; email (es) says permiso de demolición: ${/permiso de demolici/i.test(es)}`);
      expect(title).not.toMatch(/demolition/i); // fix H: the alteration is not titled a demolition permit
      expect(label).toBe('coming_soon'); // review P2-4: junk removal still gets the card
      // REQUIRED: the card must not call this alteration a demolition permit either (fix H; CONTEXT "wording matches the record").
      expect(brief.why).not.toMatch(/demolition permit/i);
      expect(en).not.toMatch(/A demolition permit was filed/i);
      expect(es).not.toMatch(/permiso de demolici/i);
    });
  }
});
