'use client';

import { useState } from 'react';
import { Button } from '@/components/button';
import { Input } from '@/components/input';
import { t, type Lang } from '@/lib/i18n';

/**
 * Door hanger / leave-behind (round 18, unit LISTS). The member types a business name and phone, picks the language of the printed card,
 * and prints. Client-side only: the form has no action, nothing is fetched, nothing goes to storage, so what is typed is gone when the page
 * closes. The printed text never names a resident, makes no damage claim (the storm line says "Damage not confirmed"), makes no insurance
 * promise, and says the business is independent, not the city or any authority. Without the storm line it mentions permits only.
 */
export const HANGER_TEXT: Record<Lang, { hello: string; body: string; storm: string; footer: string; footerStorm: string }> = {
  en: {
    hello: 'Hello, neighbor',
    body: '{business} serves your neighborhood. If you would like a quote, call or text {phone}.',
    storm: 'There was a public storm report in this area. Damage not confirmed.',
    // Without the storm line the card mentions permits only (review redo 1, defect 2).
    footer: 'We are an independent business, not a city or government office. We leave this card on streets with a public building permit. Those permits list addresses only: no names, no phone numbers.',
    footerStorm: 'We are an independent business, not a city or government office. We leave this card on streets with a public building permit near a public storm report. Those records list addresses only: no names, no phone numbers.',
  },
  es: {
    hello: 'Hola, vecino',
    body: '{business} ofrece sus servicios en su vecindario. Si desea un presupuesto, llame o envíe un mensaje al {phone}.',
    storm: 'Hubo un reporte público de tormenta en esta zona. Daño no confirmado.',
    footer: 'Somos un negocio independiente, no una oficina de la ciudad ni del gobierno. Dejamos esta tarjeta en calles con un permiso de construcción público. Esos permisos solo tienen direcciones: ni nombres ni teléfonos.',
    footerStorm: 'Somos un negocio independiente, no una oficina de la ciudad ni del gobierno. Dejamos esta tarjeta en calles con un permiso de construcción público cerca de un reporte público de tormenta. Esos registros solo tienen direcciones: ni nombres ni teléfonos.',
  },
};

/** The printed card's sentences, filled. Exported for tests. */
export function hangerLines(lang: Lang, business: string, phone: string, storm: boolean): string[] {
  const x = HANGER_TEXT[lang];
  const b = business.trim() || '____________';
  const p = phone.trim() || '____________';
  // Replacer functions: typed "$$" or "$&" is printed as typed, and a typed "{phone}" is never filled (review P3-10).
  const body = x.body.replace(/\{business\}|\{phone\}/g, (k) => (k === '{business}' ? b : p));
  return [x.hello, body, ...(storm ? [x.storm, x.footerStorm] : [x.footer])];
}

export function DoorHanger({ lang, initialBusiness = '', storm = false }: { lang: Lang; initialBusiness?: string; storm?: boolean }) {
  const [business, setBusiness] = useState(initialBusiness);
  const [phone, setPhone] = useState('');
  const [cardLang, setCardLang] = useState<Lang>(lang);
  const [withStorm, setWithStorm] = useState(storm);
  const lines = hangerLines(cardLang, business, phone, withStorm);

  return (
    <div>
      {/* Round 23. Putting unstamped mail in a mailbox is a federal offence (fines run to thousands of dollars), and some towns need a
          handbill permit, so the one line that keeps a member out of trouble sits above the form, not in the fine print. */}
      <p className="mb-5 rounded-card border border-line bg-surface p-4 text-muted print:hidden">{t(lang, 'hanger.rules')}</p>
      <form className="grid gap-4 print:hidden sm:grid-cols-2" onSubmit={(e) => e.preventDefault()} autoComplete="off">
        <Input
          label={t(lang, 'hanger.business')}
          value={business}
          maxLength={60}
          placeholder={t(lang, 'hanger.placeholder.business')}
          onChange={(e) => setBusiness(e.target.value)}
        />
        <Input
          label={t(lang, 'hanger.phone')}
          value={phone}
          maxLength={30}
          inputMode="tel"
          placeholder={t(lang, 'hanger.placeholder.phone')}
          onChange={(e) => setPhone(e.target.value)}
        />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-semibold text-ink">{t(lang, 'hanger.language')}</legend>
          <div className="flex gap-4">
            {(['en', 'es'] as const).map((l) => (
              <label key={l} className="inline-flex min-h-11 items-center gap-2 text-ink">
                <input type="radio" name="hanger-lang" value={l} checked={cardLang === l} onChange={() => setCardLang(l)} />
                {t(l, `lang.${l}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="inline-flex min-h-11 items-center gap-2 self-end text-ink">
          <input type="checkbox" checked={withStorm} onChange={(e) => setWithStorm(e.target.checked)} />
          {t(lang, 'hanger.storm')}
        </label>
        <div className="sm:col-span-2">
          <Button variant="primary" onClick={() => window.print()}>
            {t(lang, 'hanger.print')}
          </Button>
        </div>
      </form>

      <h2 className="h-plain mt-8 text-lg text-ink print:hidden">{t(lang, 'hanger.preview')}</h2>
      {/* Two cards per printed page: cut along the dashed line. */}
      <div className="mt-3 grid gap-6 print:mt-0 print:gap-0" data-testid="hanger-cards" lang={cardLang}>
        {[0, 1].map((i) => (
          <section
            key={i}
            className="break-inside-avoid rounded-card border-2 border-dashed border-line-strong bg-surface p-6 text-ink print:min-h-[48vh] print:rounded-none"
          >
            <p className="text-3xl font-semibold">{lines[0]}</p>
            <p className="mt-4 text-xl leading-snug">{lines[1]}</p>
            {lines.slice(2, -1).map((l) => (
              <p key={l} className="mt-3 text-base">{l}</p>
            ))}
            <p className="mt-6 text-sm text-muted">{lines[lines.length - 1]}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
