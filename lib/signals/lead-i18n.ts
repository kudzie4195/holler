import { localizeDate, t, type Lang } from '@/lib/i18n';
import { deadlineLine, formatDeadlineDate, type OpportunityLabel } from './lead-rules';

/**
 * The words lead-rules.ts prints on a card (the chip and the deadline line) in a language. A separate file so lead-rules.ts stays a
 * pure leaf with two imports (tests/signals/lead-rules.test.ts). 'en' gives exactly the lead-rules wording.
 */

/** "Act now" / "Actúe ahora". Context has a word too, but it is never shown as an alert. */
export function chipLabel(label: OpportunityLabel, lang: Lang = 'en'): string {
  return t(lang, `chip.${label}`);
}

/** "Deadline: Dec 5, 2026" / "Fecha límite: 5 dic 2026", or "No deadline published" / "Sin fecha límite publicada". */
export function deadlineLineLang(deadline: string | null | undefined, lang: Lang = 'en'): string {
  if (lang === 'en') return deadlineLine(deadline);
  const f = formatDeadlineDate(deadline);
  return f ? t(lang, 'deadline.line', { date: localizeDate(f, lang) }) : t(lang, 'deadline.none');
}
