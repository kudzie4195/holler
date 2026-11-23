'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '../button';
import { t, type Lang } from '@/lib/i18n';

/**
 * Copies static note text to the clipboard. Same pattern as the draft panel in the feed (navigator.clipboard, no library).
 * If the browser blocks the clipboard, the note is shown in a read-only box so it can be selected by hand.
 */
export function CopyNoteButton({ label, text, lang = 'en' }: { label: string; text: string; lang?: Lang }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('failed');
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={copy}>
        {state === 'copied' ? t(lang, 'card.copied') : label}
      </Button>
      <span role="status" className="w-full text-sm text-muted empty:hidden">
        {state === 'copied' ? t(lang, 'who.copied_hint') : state === 'failed' ? t(lang, 'who.copy_failed') : ''}
      </span>
      {state === 'failed' ? (
        <textarea
          readOnly
          aria-label={t(lang, 'who.note_text', { label })}
          value={text}
          rows={5}
          className="w-full resize-y rounded-control border border-line-strong bg-surface p-3 text-base text-ink"
        />
      ) : null}
    </>
  );
}
