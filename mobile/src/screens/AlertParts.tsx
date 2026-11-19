import { useState } from 'react';
import { ApiCallError } from '../api/client';
import type { AlertDto, ContactDto, FeedbackDto, Verdict } from '../contract';
import { api } from '../services';
import { relativeDay } from '../ui/format';
import { Button } from '../ui/kit';

const VERDICT_LABEL: Record<Verdict, string> = { useful: 'Useful', not_relevant: 'Not relevant', led_to_work: 'Led to work' };
const VERDICTS: Verdict[] = ['useful', 'not_relevant', 'led_to_work'];

export function AlertMeta({ item }: { item: AlertDto }) {
  const bits = [item.place, relativeDay(item.occurredAt), item.distanceLabel].filter(Boolean) as string[];
  return (
    <>
      <span className="intent">{item.intent.label}</span>
      <p className="alert-title">{item.title}</p>
      <div className="meta">
        {bits.map((b) => (
          <span key={b}>{b}</span>
        ))}
      </div>
      {item.intent.line ? <p className="intent-line">{item.intent.line}</p> : null}
      {item.sourceLabel ? <p className="tiny muted" style={{ marginTop: 6 }}>Source: {item.sourceLabel}</p> : null}
    </>
  );
}

export function FeedbackButtons({ signalId, initial, onSaved }: { signalId: number; initial: FeedbackDto | null; onSaved?: (f: FeedbackDto) => void }) {
  const [verdict, setVerdict] = useState<Verdict | null>(initial?.verdict ?? null);
  const [amount, setAmount] = useState(initial?.jobValueUsd != null ? String(initial.jobValueUsd) : '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(next: Verdict, jobValueUsd: number | null) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const before = verdict;
    setVerdict(next);
    try {
      const res = await api.feedback({ signalId, verdict: next, jobValueUsd });
      onSaved?.(res.feedback);
      setMessage(next === 'led_to_work' && jobValueUsd != null ? 'Saved. Thanks for telling us.' : 'Thanks. This helps us send better alerts.');
    } catch (e) {
      setVerdict(before);
      setError(e instanceof ApiCallError ? e.message : "That didn't save. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function saveAmount() {
    const n = Number(amount.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000 || !Number.isInteger(n)) {
      setError('Enter whole dollars, up to 1,000,000.');
      return;
    }
    void send('led_to_work', n);
  }

  return (
    <div className="feedback" onClick={(e) => e.stopPropagation()}>
      <p className="small muted">Was this alert helpful?</p>
      <div className="row" role="group" aria-label="Feedback on this alert" style={{ marginTop: 6 }}>
        {VERDICTS.map((v) => (
          <Button key={v} small variant="secondary" className={verdict === v ? 'chosen' : ''} aria-pressed={verdict === v} disabled={busy} onClick={() => void send(v, null)}>
            {VERDICT_LABEL[v]}
          </Button>
        ))}
      </div>
      {verdict === 'led_to_work' ? (
        <div className="row" style={{ marginTop: 10, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, minWidth: 140 }}>
            <label htmlFor={`amount-${signalId}`}>About how much was the job? (optional)</label>
            <input id={`amount-${signalId}`} inputMode="numeric" placeholder="Dollars" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <Button small variant="secondary" disabled={busy || !amount} onClick={saveAmount}>
            Save amount
          </Button>
        </div>
      ) : null}
      <p role="status" className="small muted" style={{ marginTop: 6 }}>{message}</p>
      {error ? <p role="alert" className="small" style={{ color: 'var(--danger-ink)', fontWeight: 600 }}>{error}</p> : null}
    </div>
  );
}

const ROLE_LABEL: Record<ContactDto['role'], string> = {
  site: 'Site',
  business: 'Business',
  contractor: 'Contractor',
  awardee: 'Awarded to',
  buyer: 'Buyer',
};

export function Contacts({ contacts }: { contacts: ContactDto[] }) {
  if (!contacts.length) return null;
  return (
    <section className="card" aria-labelledby="who">
      <h3 id="who">Who to contact</h3>
      <p className="small muted" style={{ marginTop: 4 }}>From the public record. Organizations and public offices only.</p>
      <div style={{ marginTop: 12 }}>
        {contacts.map((c, i) => {
          const where = [c.address, [c.city, c.state].filter(Boolean).join(', '), c.zip].filter(Boolean).join(' ');
          return (
            <div key={`${c.role}-${c.name}-${i}`} className="contact">
              <p className="tiny muted">{ROLE_LABEL[c.role] ?? c.role}</p>
              <p style={{ fontWeight: 600 }}>{c.name}</p>
              {c.attn ? <p className="small">Attn: {c.attn}</p> : null}
              {where ? <p className="small">{where}</p> : null}
              <div className="row">
                {c.phone ? <a className="btn ghost small" href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>Call {c.phone}</a> : null}
                {c.email ? <a className="btn ghost small" href={`mailto:${c.email}`}>Email</a> : null}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
