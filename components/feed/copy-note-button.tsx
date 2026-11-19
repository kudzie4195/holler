'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '../button';

/**
 * Copies static note text to the clipboard. Same pattern as the draft panel in the feed (navigator.clipboard, no library).
 * If the browser blocks the clipboard, the note is shown in a read-only box so it can be selected by hand.
 */
export function CopyNoteButton({ label, text }: { label: string; text: string }) {
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
        {state === 'copied' ? 'Copied' : label}
      </Button>
      <span role="status" className="w-full text-sm text-muted empty:hidden">
        {state === 'copied' ? 'Copied to your clipboard. Replace the [bracketed] parts before you send it.' : state === 'failed' ? 'Copy did not work here. Select the note below and copy it by hand.' : ''}
      </span>
      {state === 'failed' ? (
        <textarea
          readOnly
          aria-label={`${label}: note text`}
          value={text}
          rows={5}
          className="w-full resize-y rounded-control border border-line-strong bg-surface p-3 text-base text-ink"
        />
      ) : null}
    </>
  );
}
