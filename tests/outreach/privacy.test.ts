// Public pages, sitemap, JSON-LD and public APIs must never touch contact data. Source scan: only the signed-in feed page, its
// components and the alert-email route may import the outreach helpers or name the contacts table.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const ALLOWED = new Set([
  'app/app/page.tsx',
  'app/api/cron/notify/route.ts',
  'components/feed.tsx',
  'components/feed/who-to-contact.tsx',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}

describe('contact data stays out of public code', () => {
  const files = [...walk('app'), ...walk('components'), ...walk('lib/seo'), ...walk('lib/signals')].filter((f) => !ALLOWED.has(f));
  it('no other app, component, seo or signals file imports lib/outreach or reads holler_signal_contacts', () => {
    const offenders = files.filter((f) => {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      return /@\/lib\/outreach|holler_signal_contacts/.test(src.replace(/^\s*(\/\/|\*|\/\*).*$/gm, ''));
    });
    // lib/signals/store.ts (core unit) legitimately writes the table; nothing public may read it.
    expect(offenders.filter((f) => f !== 'lib/signals/store.ts')).toEqual([]);
  });
});
