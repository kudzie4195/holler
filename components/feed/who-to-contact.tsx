'use client';

import { useId, useMemo, useState, useSyncExternalStore } from 'react';
import type { ContactInput } from '@/lib/contacts/types';
import { hasBlock, isOrgRecord, outreachPlan, type OrgEntry, type OutreachPlan, type PlanLink } from '@/lib/outreach/plan';
import { CopyNoteButton } from './copy-note-button';
import { t, type Lang } from '@/lib/i18n';

const WIDE = '(min-width: 768px)';
function subscribeWide(cb: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(WIDE);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const isWide = () => typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches;

/** What the block needs to know about the record. Contact data is passed separately and is absent for a locked member. */
export interface ContactSignal {
  source: string;
  kind: string;
  city?: string | null;
  state?: string | null;
  county?: string | null;
  zip?: string | null;
  /** The stored public summary: a permit's job-site address is read from it when no site row is stored. */
  summary?: string | null;
  /** The record's public source page: linked next to an owner company on a code-violation card. */
  url?: string | null;
  /** The stored public title: a sale's block needs it (lib/outreach/plan.ts saleSitePlan shows a site for a commercial sale only). */
  title?: string | null;
}

const actionClass =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold text-ink hover:border-ink hover:bg-sand md:min-h-9';

function ExternalIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 3H3v10h10v-3M9 3h4v4M13 3 7.5 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ActionLink({ link, lang }: { link: PlanLink; lang: Lang }) {
  if (!link.external) {
    return (
      <a href={link.href} className={actionClass}>
        {link.label}
      </a>
    );
  }
  return (
    <a href={link.href} target={link.target} rel={link.rel} className={actionClass}>
      {link.label}
      <span className="sr-only">{t(lang, 'brief.sr_new_tab')}</span>
      <ExternalIcon />
    </a>
  );
}

function Entry({ e, lang }: { e: OrgEntry; lang: Lang }) {
  return (
    <li className="min-w-0 rounded-control border border-line bg-surface p-3">
      <p className="break-words text-base font-semibold text-ink">{e.name}</p>
      <p className="text-sm text-muted">{e.role}</p>
      {e.listing ? (
        <div className="mt-1">
          {e.listing.phone ? <p className="break-words text-sm text-ink">{t(lang, 'listing.phone', { value: e.listing.phone })}</p> : null}
          {e.listing.website ? (
            <p className="break-all text-sm text-ink">
              {t(lang, 'listing.website', { value: '' }).trimEnd()}{' '}
              <a href={e.listing.website.href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-brand-text underline">
                {e.listing.website.text}
              </a>
            </p>
          ) : null}
          <p className="text-xs text-muted">{e.listing.note}</p>
        </div>
      ) : null}
      {e.attn ? <p className="mt-1 break-words text-sm text-ink">{t(lang, 'who.attention', { value: e.attn })}</p> : null}
      {e.address ? <p className="mt-1 break-words text-sm text-ink">{t(lang, 'who.labelled', { label: e.addressLabel, value: e.address })}</p> : null}
      {e.phone ? <p className="break-words text-sm text-ink">{t(lang, 'who.phone', { value: e.phone })}</p> : null}
      {e.license ? <p className="break-words text-sm text-ink">{t(lang, 'who.license', { value: e.license })}</p> : null}
      {e.email ? <p className="break-all text-sm text-ink">{t(lang, 'who.email', { value: e.email })}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {e.search ? <ActionLink link={e.search} lang={lang} /> : null}
        {e.map ? <ActionLink link={e.map} lang={lang} /> : null}
        {e.website ? <ActionLink link={e.website} lang={lang} /> : null}
        <CopyNoteButton label={t(lang, 'who.copy_note')} text={e.note} lang={lang} />
      </div>
    </li>
  );
}

function Body({ plan, lang }: { plan: OutreachPlan; lang: Lang }) {
  if (plan.type === 'org') {
    return (
      <>
        <ul className="flex flex-col gap-3">
          {plan.entries.map((e) => (
            <Entry key={e.key} e={e} lang={lang} />
          ))}
        </ul>
        {plan.moreCount > 0 ? (
          <p className="mt-2 text-sm text-muted">
            {t(lang, 'who.more', { n: plan.moreCount })}
          </p>
        ) : null}
      </>
    );
  }
  if (plan.type === 'site') {
    return (
      <div className="rounded-control border border-line bg-surface p-3">
        <p className="text-base font-semibold text-ink">{plan.heading}</p>
        <p className="mt-1 break-words text-sm text-ink">{t(lang, 'who.labelled', { label: t(lang, 'who.address'), value: plan.address })}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {plan.map ? <ActionLink link={plan.map} lang={lang} /> : null}
          {plan.letter ? <CopyNoteButton label={plan.letter.label} text={plan.letter.note} lang={lang} /> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-control border border-line bg-surface p-3">
      {plan.owner ? (
        <div className="mb-3 border-b border-line pb-3" data-testid="owner-record">
          <p className="break-words text-sm text-ink">{plan.owner.line}</p>
          {plan.owner.source ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <ActionLink link={plan.owner.source} lang={lang} />
            </div>
          ) : null}
        </div>
      ) : null}
      {plan.building ? (
        <p className="mb-3 break-words border-b border-line pb-3 text-sm text-ink" data-testid="building-block">
          {plan.building}
        </p>
      ) : null}
      <p className="text-base font-semibold text-ink">{t(lang, 'who.reach_area')}</p>
      {plan.place ? <p className="mt-1 break-words text-sm text-ink">{t(lang, 'who.labelled', { label: t(lang, /county\b|condado/i.test(plan.place.split(',')[0]) ? 'who.area' : 'who.city'), value: plan.place })}</p> : null}
      {plan.zips.length > 0 ? (
        <p className="break-words text-sm text-ink">
          {t(lang, 'who.labelled', { label: t(lang, plan.zips.length === 1 ? 'who.zip' : 'who.zips'), value: plan.zips.join(', ') })}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ActionLink link={plan.eddm} lang={lang} />
        <CopyNoteButton label={plan.noteLabel} text={plan.note} lang={lang} />
      </div>
      <p className="mt-3 text-sm text-muted">
        {plan.rules} <a href={plan.guide.href} className="font-medium text-brand-text underline">{plan.guide.label}</a>.
      </p>
    </div>
  );
}

/**
 * "Who to contact" for one alert, inside its card. A disclosure: closed on phones, opened on wider screens after load.
 * Native details/summary, so it works with the keyboard (Enter or Space on the summary) and is announced as expandable.
 */
export function WhoToContact({ item, contacts, lang = 'en' }: { item: ContactSignal; contacts?: ContactInput[] | null; lang?: Lang }) {
  const plan = useMemo(() => outreachPlan(item, contacts, lang), [item, contacts, lang]);
  // Closed on phones, open on wider screens (the server render is always closed). Once the member toggles it, their choice stays.
  const wide = useSyncExternalStore(subscribeWide, isWide, () => false);
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? wide;
  const headingId = useId();

  if (!plan) return null;
  const summaryCount = plan.type === 'org' ? plan.entries.length + plan.moreCount : null;
  return (
    <section aria-labelledby={headingId} className="mt-4 border-t border-line pt-1">
      <details open={open} onToggle={(e) => { if (e.currentTarget.open !== open) setManual(e.currentTarget.open); }} className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-control text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
          <span id={headingId}>
            {t(lang, 'who.heading')}
            {summaryCount ? <span className="ml-2 font-mono text-xs tabular-nums text-muted">{summaryCount}</span> : null}
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted">
            <span className="group-open:hidden">{t(lang, 'who.show')}</span>
            <span className="hidden group-open:inline">{t(lang, 'who.hide')}</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="transition-transform group-open:rotate-180">
              <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </summary>
        <div className="pb-1 pt-2">
          <Body plan={plan} lang={lang} />
          <p className="mt-3 text-sm text-muted">{plan.reminder}</p>
        </div>
      </details>
    </section>
  );
}

/** Locked member: the heading and a short prompt, never contact data. Rendered only for records that have a block. */
export function WhoToContactLocked({ item, lang = 'en' }: { item: Pick<ContactSignal, 'source' | 'kind'>; lang?: Lang }) {
  if (!hasBlock(item.source, item.kind)) return null;
  return (
    <section className="mt-4 border-t border-line pt-3">
      <h3 className="text-sm font-semibold text-ink">{t(lang, 'who.heading')}</h3>
      <p className="mt-1 text-sm text-muted">
        {isOrgRecord(item.source, item.kind)
          ? t(lang, 'who.locked.org')
          : t(lang, 'who.locked.area')}
      </p>
    </section>
  );
}
