import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import type { ContactRecord } from '@/lib/contacts/types';
import { loadMemberContacts, type ContactLoader } from '@/lib/outreach/loader';

const db = {} as never;
const rec = (signalId: number, over: Partial<ContactRecord> = {}): ContactRecord => ({ signalId, role: 'contractor', name: 'Acme Roofing LLC', ...over });

describe('loadMemberContacts', () => {
  it('does not call the loader for a locked member', async () => {
    const loader = vi.fn<ContactLoader>(async () => new Map([[1, [rec(1)]]]));
    const out = await loadMemberContacts({ db, userId: 'u1', signalIds: [1], locked: true, loader });
    expect(out.size).toBe(0);
    expect(loader).not.toHaveBeenCalled();
  });

  it('asks only for valid, de-duplicated, capped signal ids', async () => {
    const loader = vi.fn<ContactLoader>(async () => new Map());
    await loadMemberContacts({ db, userId: 'u1', signalIds: [3, 3, -1, 0, 1.5, NaN, ...Array.from({ length: 300 }, (_, i) => i + 10)], loader });
    const ids = loader.mock.calls[0][2];
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(100);
    expect(ids.every((n) => Number.isSafeInteger(n) && n > 0)).toBe(true);
  });

  it('returns only the ids asked for and contacts filed under their own signal id', async () => {
    const loader: ContactLoader = async () =>
      new Map([
        [1, [rec(1), rec(2, { name: 'Other Signal Co' })]],
        [99, [rec(99, { name: 'Not Requested LLC' })]],
      ]);
    const out = await loadMemberContacts({ db, userId: 'u1', signalIds: [1], loader, orgCheck: null });
    expect([...out.keys()]).toEqual([1]);
    expect(out.get(1)!.map((c) => c.name)).toEqual(['Acme Roofing LLC']);
  });

  it('drops a contractor, business or awardee the classifier does not accept; keeps site and buyer', async () => {
    const loader: ContactLoader = async () =>
      new Map([[1, [rec(1, { name: 'John Smith' }), rec(1, { role: 'business', name: 'Smith Roofing' }), rec(1, { role: 'site', name: '', address: '1 A St' }), rec(1, { role: 'buyer', name: 'City Procurement' })]]]);
    const out = await loadMemberContacts({ db, userId: 'u1', signalIds: [1], loader, orgCheck: (n) => /roofing|procurement/i.test(n) });
    expect(out.get(1)!.map((c) => c.name)).toEqual(['Smith Roofing', '', 'City Procurement']);
  });

  it('a throwing or malformed loader means no contacts, never an error', async () => {
    expect((await loadMemberContacts({ db, userId: 'u1', signalIds: [1], loader: async () => { throw new Error('x'); } })).size).toBe(0);
    expect((await loadMemberContacts({ db, userId: 'u1', signalIds: [1], loader: (async () => ({})) as never })).size).toBe(0);
    expect((await loadMemberContacts({ db, userId: '', signalIds: [1], loader: async () => new Map([[1, [rec(1)]]]) })).size).toBe(0);
  });

  it('with no loader available (module missing) the answer is no contacts', async () => {
    expect((await loadMemberContacts({ db, userId: 'u1', signalIds: [1], loader: null })).size).toBe(0);
  });
});
