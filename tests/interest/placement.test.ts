// Placement and hygiene: /pricing stays static, the feed has one line added, no dashes in the new files, no persisted visitor data.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(p, 'utf8');

describe('placement', () => {
  const pricing = read('app/pricing/page.tsx');
  it('/pricing shows the list below the plans and above the FAQ', () => {
    const plans = pricing.indexOf('<Pricing />');
    const list = pricing.indexOf('<ComingNext page="pricing" />');
    const faq = pricing.indexOf('id="faq-h"');
    expect(plans).toBeGreaterThan(-1);
    expect(list).toBeGreaterThan(plans);
    expect(faq).toBeGreaterThan(list);
  });
  it('/pricing stays static: no cookies, headers or connection on the server', () => {
    expect(pricing).not.toMatch(/next\/headers|connection\(|cookies\(|getUser|createClient/);
    expect(read('components/coming-next.tsx')).toMatch(/^'use client';/);
    expect(read('components/coming-next.tsx')).not.toMatch(/next\/headers|server-only/);
  });
  it('the feed page has one import and one JSX line for the list', () => {
    const feed = read('app/app/page.tsx');
    expect(feed.match(/ComingNextForMember/g)).toHaveLength(2);
    expect(feed).toContain("import { ComingNextForMember } from '@/components/coming-next-member';");
    expect(feed).toContain('<ComingNextForMember />');
  });
});

describe('hygiene', () => {
  const files = [
    'lib/interest/features.ts',
    'lib/interest/cookie.ts',
    'lib/interest/service.ts',
    'lib/interest/deps.ts',
    'app/api/interest/route.ts',
    'components/coming-next.tsx',
    'components/coming-next-member.tsx',
    'supabase/migrations/0008_holler_feature_interest.sql',
    'app/privacy/page.tsx',
    'LAUNCH.md',
  ];
  it('has no em dash or en dash', () => {
    for (const f of files) expect(read(f), f).not.toMatch(/[–—]/);
  });
  it('the migration stores no visitor identifier and only touches holler_ objects', () => {
    const sql = read('supabase/migrations/0008_holler_feature_interest.sql');
    const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(code).not.toMatch(/\b(ip|ip_hash|visitor|user_agent|ua)\b\s+(text|inet|uuid)/i);
    for (const m of code.matchAll(/(?:table|index|function|trigger)(?: if (?:not )?exists)? (?:public\.)?([a-z_]+)/gi)) {
      if (['on', 'for', 'after', 'if'].includes(m[1])) continue;
      expect(m[1].startsWith('holler_'), m[1]).toBe(true);
    }
  });
  it('the service never stores an ip: the only write shapes are feature, page and user_id', () => {
    const svc = read('lib/interest/service.ts');
    expect(svc).toContain('{ feature, page, user_id: null }');
    expect(svc).toContain('{ feature, user_id: input.userId, page }');
  });
  it('the privacy page says picks are saved and names the cookie', () => {
    const p = read('app/privacy/page.tsx');
    expect(p).toContain('holler_picked');
    expect(p).toMatch(/with your account if you are signed in, and with no name or ID if you are not/);
  });
});
