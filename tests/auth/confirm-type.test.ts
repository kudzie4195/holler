// Fixtures: hand-written (assumed). Holler only issues password recovery links (F-4).
import { describe, expect, it } from 'vitest';
import { CONFIRM_TYPES, isConfirmType } from '../../lib/auth/otp';

describe('confirm link types', () => {
  it('accepts only recovery', () => {
    expect(CONFIRM_TYPES).toEqual(['recovery']);
    expect(isConfirmType('recovery')).toBe(true);
  });
  it.each(['email', 'signup', 'magiclink', 'invite', 'email_change', '', 'RECOVERY', null, undefined, 1])('rejects %s', (t) => {
    expect(isConfirmType(t)).toBe(false);
  });
});
