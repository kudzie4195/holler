// Shared by the round 7 legal tests: render a legal page with the real page function (DocPage swapped for a plain shell, mocked in
// each test file with vi.mock before this is used) and give back html, text and the prose numbers the copy gate uses.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

export type LegalPage = 'terms' | 'privacy' | 'delete-account';

export function docPageMock() {
  return {
    DocPage: ({ title, intro, updated, children }: { title: string; intro?: string; updated?: string; children: ReactNode }) =>
      createElement(
        'main',
        null,
        createElement('h1', null, title),
        intro ? createElement('p', null, intro) : null,
        updated ? createElement('p', null, `Last updated ${updated}`) : null,
        children,
      ),
    DocSection: ({ title, children }: { title: string; children: ReactNode }) =>
      createElement('section', null, createElement('h2', null, title), children),
  };
}

export async function renderLegal(page: LegalPage, support = 'support@localholler.com') {
  vi.resetModules();
  vi.stubEnv('SUPPORT_EMAIL', support);
  const mod =
    page === 'terms'
      ? await import('@/app/terms/page')
      : page === 'privacy'
        ? await import('@/app/privacy/page')
        : await import('@/app/delete-account/page');
  const html = renderToStaticMarkup(createElement(mod.default));
  const text = html
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<\/(p|li|h1|h2|address)>/g, '.\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();
  return { html, text, metadata: mod.metadata };
}

/** Repo file as text. */
export const src = (p: string) => readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

/**
 * The copy gate as /home/claude/gates/prose_metrics.py measures it: only <p> blocks of 4+ words, split on . ! ? followed by space,
 * sentences of 2+ words; mean, population stdev / mean, share under 8 words.
 */
export function proseMetrics(html: string) {
  const unescape = (t: string) =>
    t
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&apos;|&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  const paras: string[] = [];
  for (const m of html.matchAll(/<(p|dd)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = unescape(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (t.split(' ').length >= 4) paras.push(t);
  }
  const counts = paras
    .flatMap((p) => p.split(/(?<=[.!?])\s+/))
    .map((s) => s.split(/\s+/).filter(Boolean).length)
    .filter((n) => n >= 2);
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const sd = Math.sqrt(counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length);
  return { n: counts.length, mean, cv: sd / mean, under8: counts.filter((n) => n < 8).length / counts.length };
}
