// Review r6 P1 (privacy manifest) and decision 10 (package identifiers everywhere).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(path.join(root, f), 'utf8');

describe('privacy manifest', () => {
  const manifest = read('ios/App/App/PrivacyInfo.xcprivacy');
  const declared = [...manifest.matchAll(/<string>(NSPrivacyCollectedDataType[A-Za-z]+)<\/string>/g)].map((m) => m[1]).filter((t) => !t.includes('Purpose'));
  it('declares Name (Apple / Google full name, business name), keyword watches and the job amount', () => {
    expect(declared).toEqual(
      expect.arrayContaining([
        'NSPrivacyCollectedDataTypeName',
        'NSPrivacyCollectedDataTypeOtherUserContent',
        'NSPrivacyCollectedDataTypeOtherFinancialInfo',
      ]),
    );
    expect(manifest).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  });
  it('the App Store and Play answers name every declared type', () => {
    const setup = read('STORE-SETUP.md');
    for (const label of ['Name', 'Other Financial Info', 'Other User Content', 'Email Address', 'Coarse Location', 'Purchase History', 'Product Interaction']) {
      expect(setup).toContain(label);
    }
  });
});

describe('package identifiers', () => {
  it('are solo_monthly, solo_annual, pro_monthly, pro_annual in the docs and the capture mock', () => {
    const mock = read('store/shims/purchases-mock.ts');
    const ids = [...mock.matchAll(/\{ id: '([a-z_]+)'/g)].map((m) => m[1]);
    expect(ids).toEqual(['solo_monthly', 'solo_annual', 'pro_monthly', 'pro_annual']);
    for (const doc of ['STORE-SETUP.md', 'RELEASE.md']) expect(read(doc)).not.toMatch(/\b(solo|pro)_yearly\b/);
    expect(read('STORE-SETUP.md')).toContain('`solo_monthly`, `solo_annual`, `pro_monthly`, `pro_annual`');
  });
});
