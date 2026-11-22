'use client';

import { useId, useMemo, useState, useSyncExternalStore } from 'react';
import type { ContactInput } from '@/lib/contacts/types';
import { hasBlock, mayHaveContacts, outreachPlan, type OrgEntry, type OutreachPlan, type PlanLink } from '@/lib/outreach/plan';
import { CopyNoteButton } from './copy-note-button';

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

function ActionLink({ link }: { link: PlanLink }) {
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
      <span className="sr-only"> (opens in a new tab)</span>
      <ExternalIcon />
    </a>
  );
}

function Entry({ e }: { e: OrgEntry }) {
  return (
    <li className="min-w-0 rounded-control border border-line bg-surface p-3">
      <p className="break-words text-base font-semibold text-ink">{e.name}</p>
      <p className="text-sm text-muted">{e.role}</p>
      {e.attn ? <p className="mt-1 break-words text-sm text-ink">Attention: {e.attn}</p> : null}
      {e.address ? <p className="mt-1 break-words text-sm text-ink">{e.addressLabel}: {e.address}</p> : null}
      {e.phone ? <p className="break-words text-sm text-ink">Phone: {e.phone}</p> : null}
      {e.license ? <p className="break-words text-sm text-ink">Contractor license number: {e.license}</p> : null}
      {e.email ? <p className="break-all text-sm text-ink">Email: {e.email}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {e.search ? <ActionLink link={e.search} /> : null}
        {e.map ? <ActionLink link={e.map} /> : null}
        {e.website ? <ActionLink link={e.website} /> : null}
        <CopyNoteButton label="Copy a first note" text={e.note} />
      </div>
    </li>
  );
}

function Body({ plan }: { plan: OutreachPlan }) {
  if (plan.type === 'org') {
    return (
      <>
        <ul className="flex flex-col gap-3">
          {plan.entries.map((e) => (
            <Entry key={e.key} e={e} />
          ))}
        </ul>
        {plan.moreCount > 0 ? (
          <p className="mt-2 text-sm text-muted">
            and {plan.moreCount} more. Open the source to see the full record.
          </p>
        ) : null}
      </>
    );
  }
  if (plan.type === 'site') {
    return (
      <div className="rounded-control border border-line bg-surface p-3">
        <p className="text-base font-semibold text-ink">{plan.heading}</p>
        <p className="mt-1 break-words text-sm text-ink">Address: {plan.address}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {plan.map ? <ActionLink link={plan.map} /> : null}
          {plan.letter ? <CopyNoteButton label={plan.letter.label} text={plan.letter.note} /> : null}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-control border border-line bg-surface p-3">
      <p className="text-base font-semibold text-ink">Reach this area</p>
      {plan.place ? <p className="mt-1 break-words text-sm text-ink">City: {plan.place}</p> : null}
      {plan.zips.length > 0 ? (
        <p className="break-words text-sm text-ink">
          {plan.zips.length === 1 ? 'ZIP code' : 'ZIP codes'}: {plan.zips.join(', ')}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ActionLink link={plan.eddm} />
        <CopyNoteButton label={plan.noteLabel} text={plan.note} />
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
export function WhoToContact({ item, contacts }: { item: ContactSignal; contacts?: ContactInput[] | null }) {
  const plan = useMemo(() => outreachPlan(item, contacts), [item, contacts]);
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
            Who to contact
            {summaryCount ? <span className="ml-2 font-mono text-xs tabular-nums text-muted">{summaryCount}</span> : null}
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-muted">
            <span className="group-open:hidden">Show</span>
            <span className="hidden group-open:inline">Hide</span>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="transition-transform group-open:rotate-180">
              <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </summary>
        <div className="pb-1 pt-2">
          <Body plan={plan} />
          <p className="mt-3 text-sm text-muted">{plan.reminder}</p>
        </div>
      </details>
    </section>
  );
}

/** Locked member: the heading and a short prompt, never contact data. Rendered only for records that have a block. */
export function WhoToContactLocked({ item }: { item: Pick<ContactSignal, 'source' | 'kind'> }) {
  if (!hasBlock(item.source, item.kind)) return null;
  return (
    <section className="mt-4 border-t border-line pt-3">
      <h3 className="text-sm font-semibold text-ink">Who to contact</h3>
      <p className="mt-1 text-sm text-muted">
        {mayHaveContacts(item.source, item.kind)
          ? 'Pick a plan to see who this record names and how to reach them.'
          : 'Pick a plan to see how to reach this area.'}
      </p>
    </section>
  );
}
