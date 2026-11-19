import Link from 'next/link';
import { COL, H2 } from './styles';

const MORE = [
  { href: '/faq', label: 'All questions' },
  { href: '/guides', label: 'Guides' },
  { href: '/data', label: 'Data' },
];

/**
 * "Straight answers": the four questions open, as the design shows them (no accordion: four short answers read faster than four
 * clicks, and the text Google reads is the text a visitor sees). Driven by homeCopy().faqs, the same list the FAQPage JSON-LD uses.
 */
export function Faq({ faqs }: { faqs: { q: string; a: string }[] }) {
  return (
    <section id="faq" aria-labelledby="faq-h" className="bg-background">
      <div className={`${COL} flex flex-wrap gap-10 pb-24`}>
        <h2 id="faq-h" className={`${H2} flex-[1_1_300px]`}>
          Straight answers
        </h2>
        <div className="flex min-w-0 flex-[2_1_520px] flex-col">
          {faqs.map((f, i) => (
            <div key={f.q} className={`flex flex-col gap-1.5 py-[22px] ${i === 0 ? 'border-t-2 border-ink' : 'border-t border-line-strong/40'}`}>
              <h3 className="m-0 text-xl font-semibold">{f.q}</h3>
              <p className="m-0 text-muted">{f.a}</p>
            </div>
          ))}
          <nav aria-label="More answers" className="flex flex-wrap gap-x-6 border-t border-line-strong/40 pt-2">
            {MORE.map((m) => (
              <Link key={m.href} href={m.href} className="h-link font-semibold text-brand-text underline underline-offset-4">
                {m.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </section>
  );
}
