'use client';

import { useId, useState } from 'react';
import { StatusBadge } from './badge';
import { Button } from './button';
import { controlClasses } from './field';
import { hardNavigate } from './format';
import { t, type Lang } from '@/lib/i18n';

/** Same rules as lib/requests/constants.ts, kept literal so this client file imports no server code. */
const REPLY_MIN = 20;
const REPLY_MAX = 800;

export type RequestReplyState = 'open' | 'replied' | 'closed' | 'full';

/**
 * Reply control for a resident request in the feed. The server decides everything (lib/requests/service.ts replyToRequest);
 * this only collects the message and shows the answer.
 */
export function RequestReply({
  matchId,
  state,
  onReplied,
  lang = 'en',
}: {
  matchId: number;
  /** undefined while the feed is still asking the server. */
  state: RequestReplyState | undefined;
  onReplied: (matchId: number) => void;
  lang?: Lang;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  if (state === 'replied') {
    return (
      <span className="inline-flex min-h-11 items-center md:min-h-9">
        <StatusBadge tone="success">{t(lang, 'card.reply.replied')}</StatusBadge>
      </span>
    );
  }
  if (state === 'closed' || state === 'full') {
    return (
      <span className="inline-flex min-h-11 items-center text-sm text-muted md:min-h-9">
        {state === 'closed' ? t(lang, 'card.reply.closed') : t(lang, 'card.reply.full')}
      </span>
    );
  }

  async function send() {
    const message = text.trim();
    if (message.length < REPLY_MIN) {
      setError(t(lang, 'card.reply.min', { n: REPLY_MIN }));
      return;
    }
    if (message.length > REPLY_MAX) {
      setError(t(lang, 'card.reply.max', { n: REPLY_MAX }));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/requests/reply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ matchId, message }),
      });
      if (res.status === 401) {
        hardNavigate('/login?next=/app');
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: string; message?: string };
      if (res.ok && body.ok) {
        setOpen(false);
        onReplied(matchId);
      } else if (body.code === 'already_replied') {
        onReplied(matchId);
      } else {
        setError((lang === 'en' ? body.message : null) ?? t(lang, 'card.reply.error'));
      }
    } catch {
      setError(t(lang, 'card.draft_err.network'));
    }
    setPending(false);
  }

  if (!open) {
    return (
      <Button size="sm" variant="primary" onClick={() => setOpen(true)} aria-expanded={false} aria-controls={`${id}-panel`}>
        {t(lang, 'card.reply.button')}
      </Button>
    );
  }

  return (
    <div id={`${id}-panel`} className="mt-2 w-full rounded-card border border-line bg-background p-4">
      <label htmlFor={`${id}-text`} className="text-sm font-semibold text-ink">
        {t(lang, 'card.reply.label')}
      </label>
      <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
        {t(lang, 'card.reply.hint')}
      </p>
      <textarea
        id={`${id}-text`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        maxLength={REPLY_MAX}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint ${id}-count${error ? ` ${id}-error` : ''}`}
        className={`${controlClasses} mt-2 resize-y py-3`}
      />
      <p id={`${id}-count`} className="mt-1 text-right font-mono text-xs tabular-nums text-muted">
        {text.trim().length} / {REPLY_MAX}
      </p>
      <p id={`${id}-error`} role="alert" className="text-sm font-medium text-danger empty:hidden">
        {error}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={send} disabled={pending}>
          {pending ? t(lang, 'card.reply.sending') : t(lang, 'card.reply.send')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          {t(lang, 'card.reply.cancel')}
        </Button>
      </div>
    </div>
  );
}
