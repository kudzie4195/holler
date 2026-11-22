// Round 19 UNIFY: the other branch's NYC managing-agent join skipped registrations whose registrationenddate has passed (their recon of
// 2026-11-22). This base keeps its own adapter (lib/signals/adapters/nyc-hpd.ts) and takes that one improvement.
import { describe, expect, it } from 'vitest';
import { groupRegistrations, isExpiredRegistration, registrationsQuery } from '@/lib/signals/adapters/nyc-hpd';

const NOW = Date.parse('2026-11-22T12:00:00Z');

describe('expired HPD registrations', () => {
  it('asks for registrationenddate and nothing that names a person', () => {
    const q = registrationsQuery([{ boro: '3', block: '1610', lot: '2' }]);
    expect(q.get('$select')).toBe('registrationid,boroid,block,lot,registrationenddate');
  });

  it('a registration that ended before now is expired; a missing or unreadable date is not', () => {
    expect(isExpiredRegistration({ registrationenddate: '2026-09-01T00:00:00.000' }, NOW)).toBe(true);
    expect(isExpiredRegistration({ registrationenddate: '2027-09-01T00:00:00.000' }, NOW)).toBe(false);
    expect(isExpiredRegistration({}, NOW)).toBe(false);
    expect(isExpiredRegistration({ registrationenddate: 'soon' }, NOW)).toBe(false);
  });

  it('groupRegistrations leaves expired registrations out only when given the clock (old callers unchanged)', () => {
    const rows = [
      { registrationid: '131179', boroid: '3', block: '1610', lot: '2', registrationenddate: '2026-09-01T00:00:00.000' },
      { registrationid: '140001', boroid: '3', block: '1610', lot: '2', registrationenddate: '2027-09-01T00:00:00.000' },
    ];
    const wanted = new Set(['3-1610-2']);
    expect(groupRegistrations(rows, wanted, NOW).get('3-1610-2')).toEqual(['140001']);
    expect(groupRegistrations(rows, wanted).get('3-1610-2')).toEqual(['131179', '140001']);
  });
});
