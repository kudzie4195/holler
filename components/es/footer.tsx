import Link from 'next/link';
import { COMPANY } from '@/lib/legal/company';
import { contactAddress } from '@/lib/email/templates';
import { PAGE_BOX } from '../grid';
import { Logo } from '../logo';
import { t } from '@/lib/i18n';

const L = 'es' as const;

/** Footer of the Spanish public pages. Privacy, terms and pricing are in English, and the links say so. */
export function FooterEs({ englishHref = '/' }: { englishHref?: string }) {
  const contact = contactAddress();
  const linkCls = 'h-link text-[0.9375rem] leading-snug text-on-brand';
  return (
    <footer className="on-brand mt-auto bg-ink">
      <div className={`${PAGE_BOX} grid gap-8 pb-8 pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-12`}>
        <div className="flex max-w-sm flex-col gap-3">
          <Logo size={34} href="/es" ariaLabel={t(L, 'nav.home')} className="self-start" />
          <p className="text-balance text-[0.9375rem] text-on-brand-faint">{t(L, 'footer.tag')}</p>
        </div>
        <nav aria-label={t(L, 'footer.aria')}>
          <ul className="flex flex-col">
            <li>
              <Link href="/es/check" className={linkCls}>{t(L, 'nav.check')}</Link>
            </li>
            <li>
              <Link href="/pricing" hrefLang="en" className={linkCls}>{t(L, 'nav.pricing')}</Link>
            </li>
            <li>
              <Link href="/privacy" hrefLang="en" className={linkCls}>{t(L, 'footer.privacy')}</Link>
            </li>
            <li>
              <Link href="/terms" hrefLang="en" className={linkCls}>{t(L, 'footer.terms')}</Link>
            </li>
            {contact ? (
              <li>
                <a href={`mailto:${contact}`} className={linkCls}>{t(L, 'footer.support')}</a>
              </li>
            ) : null}
            <li>
              <a href={englishHref} hrefLang="en" lang="en" className={linkCls}>{t(L, 'footer.english')}</a>
            </li>
          </ul>
        </nav>
      </div>
      <div className={`${PAGE_BOX} pb-10`}>
        <div className="flex flex-col gap-2 border-t border-brand-raised pt-6 text-sm text-on-brand-faint">
          <p className="text-pretty">{t(L, 'footer.disclaimer')}</p>
          <address className="not-italic">
            {t(L, 'footer.run_by', { brand: COMPANY.brand, legal: COMPANY.legalName, address: COMPANY.addressLine })}
          </address>
        </div>
      </div>
    </footer>
  );
}
