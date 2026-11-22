import { describe, expect, it } from 'vitest';
import { cleanOrgName } from '@/lib/contacts/org';

// Final review (Nov 22): two given-name words before a trade word read as a person's name and must stay out of contacts.
describe('rescue rule keeps two-name person names out', () => {
  it.each(['Christian Austin Construction', 'Madison Rose Painting', 'Austin Rose Realty', 'ROSE MADISON & AUSTIN CHRISTIAN HOMES'])('%s is rejected', (n) => {
    expect(cleanOrgName(n)).toBeNull();
  });
  it.each(['Madison Electric', 'Lone Star Roofing LLC', 'Capitol Electric Inc', 'Magnolia Point Properties', 'Queen City Electric'])('%s still passes', (n) => {
    expect(cleanOrgName(n)).toBe(n);
  });
});
