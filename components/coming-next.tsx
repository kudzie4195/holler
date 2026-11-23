'use client';

import { useId, useState, useSyncExternalStore } from 'react';
import { Button } from './button';
import { pickedFromCookieString } from '@/lib/interest/cookie';
import { COMING_NEXT, FEATURES, type FeatureId } from '@/lib/interest/features';
import { t, type Lang } from '@/lib/i18n';

/** The words of the list in a language. English is COMING_NEXT and FEATURES exactly as they were. */
function copyFor(lang: Lang) {
  if (lang === 'en') return { text: COMING_NEXT as { [K in keyof typeof COMING_NEXT]: string }, features: FEATURES.map((f) => ({ id: f.id as FeatureId, label: f.label as string, description: f.description as string })) };
  return {
    text: {
      heading: t(lang, 'next.heading'),
      intro: t(lang, 'next.intro'),
      button: t(lang, 'next.button'),
      picked: t(lang, 'next.picked'),
      thanks: t(lang, 'next.thanks'),
      error: t(lang, 'next.error'),
    },
    // "Holler in Spanish" is not offered on a Spanish page: it is what the reader is using.
    features: FEATURES.filter((f) => f.id !== 'spanish').map((f) => ({
      id: f.id as FeatureId,
      label: t(lang, `next.f.${f.id as Exclude<FeatureId, 'spanish'>}.label`),
      description: t(lang, `next.f.${f.id as Exclude<FeatureId, 'spanish'>}.desc`),
    })),
  };
}

const noop = () => () => {};
/** The raw cookie string, read after mount. The server and the first client render both see '' so nothing mismatches. */
const readCookie = () => document.cookie;
const serverCookie = () => '';

/**
 * The "Coming next" list. People press "I want this" on features that do not exist yet, and the owner counts picks later.
 * Server render: every button reads "I want this". After mount the holler_picked cookie (and, for a member, the picks passed in
 * `initialPicked`) turn the matching buttons into a disabled "Picked". Static pages stay static because nothing here reads cookies
 * on the server. No counts are shown anywhere.
 */
export function ComingNext({
  page,
  initialPicked = [],
  className = '',
  split = false,
  lang = 'en',
}: {
  page: string;
  /** The reader's language. English is the default and unchanged. */
  lang?: Lang;
  initialPicked?: readonly FeatureId[];
  className?: string;
  /** From md up: heading in the left third, intro and list in the right two thirds (the /pricing lower sections). */
  split?: boolean;
}) {
  const headingId = useId();
  const { text: COPY, features } = copyFor(lang);
  const cookie = useSyncExternalStore(noop, readCookie, serverCookie);
  const [local, setLocal] = useState<FeatureId[]>([]);
  const [busy, setBusy] = useState<FeatureId | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const picked = new Set<FeatureId>([...initialPicked, ...pickedFromCookieString(cookie), ...local]);

  async function pick(feature: FeatureId, label: string) {
    if (busy || picked.has(feature)) return;
    setBusy(feature);
    setMessage(null);
    try {
      const res = await fetch('/api/interest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ feature, page }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (data?.ok || data?.error === 'already') {
        setLocal((l) => [...l, feature]);
        setMessage({ text: `${COPY.thanks} ${label}`, error: false });
      } else {
        setMessage({ text: COPY.error, error: true });
      }
    } catch {
      setMessage({ text: COPY.error, error: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-labelledby={headingId}
      className={`${split ? 'md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12' : ''} ${className}`.trim() || undefined}
    >
      <h2 id={headingId} className="text-3xl text-ink md:text-4xl">
        {COPY.heading}
      </h2>
      <div className="min-w-0">
        <p className={`mt-2 text-muted ${split ? 'md:mt-0' : ''}`}>{COPY.intro}</p>
        <ul className="mt-6 border-t-2 border-ink">
          {features.map((f) => {
            const isPicked = picked.has(f.id);
            return (
              <li key={f.id} className="flex flex-col gap-3 border-b border-line py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold text-ink">{f.label}</h3>
                  <p className="mt-1 text-muted">{f.description}</p>
                </div>
                <Button
                  variant={isPicked ? 'ghost' : 'secondary'}
                  size="md"
                  className="w-full shrink-0 sm:w-36"
                  disabled={isPicked || busy !== null}
                  aria-label={`${isPicked ? COPY.picked : COPY.button}: ${f.label}`}
                  onClick={() => pick(f.id, f.label)}
                >
                  {isPicked ? COPY.picked : COPY.button}
                </Button>
              </li>
            );
          })}
        </ul>
        {/* Always in the layout, so a message never moves the list. role=status announces it. */}
        <p role="status" className={`mt-3 min-h-6 text-sm ${message?.error ? 'text-danger' : 'text-muted'}`}>
          {message?.text ?? ''}
        </p>
      </div>
    </section>
  );
}
