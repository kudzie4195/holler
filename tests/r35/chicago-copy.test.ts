import { describe, expect, it } from 'vitest';
import { en } from '../../lib/i18n/en';
import { es } from '../../lib/i18n/es';
import { briefFor } from '../../lib/signals/brief';

// Round 35: Chicago violation and inspection cards carry a hundred-block only. No next-step line may promise an address for them.
describe('r35 Chicago copy: violation and inspection cards promise a block, not an address', () => {
  it('EN and ES next-step lines say block', () => {
    for (const k of ['brief.next.violation', 'brief.next.inspection'] as const) {
      expect((en as Record<string, string>)[k]).toMatch(/\bblock\b/);
      expect((en as Record<string, string>)[k]).not.toMatch(/address/i);
      expect((es as Record<string, string>)[k]).toMatch(/cuadra/);
      expect((es as Record<string, string>)[k]).not.toMatch(/direcci/i);
    }
  });
  it('the card brief for a Chicago inspection says block', () => {
    const b = briefFor({ source: 'socrata-chicago-inspections', label: 'act_now', trade: 'pest-control' });
    expect(b.next).toMatch(/block/);
    expect(b.next).not.toMatch(/address/i);
  });
  it('no em-dash in the changed lines', () => {
    for (const k of ['brief.next.violation', 'brief.next.inspection', 'brief.next.other'] as const) {
      expect((en as Record<string, string>)[k]).not.toContain('—');
      expect((es as Record<string, string>)[k]).not.toContain('—');
    }
  });
});
