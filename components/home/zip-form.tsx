import { t, type Lang } from '@/lib/i18n';

/**
 * The ZIP check on green (hero and closing band). A plain GET form to /check with one field, `zip`; no client JavaScript.
 * /check with a ZIP and no trade shows its form with the ZIP filled in and asks for a trade (unit C).
 * Field: brand-deep fill, brand-line edge (4.17:1), on-brand text; the placeholder is on-brand-faint (7.8:1). Button: signal with ink;
 * on hover the darker lime token signal-hover, which reads as a change where a brighter lime did not. As in components/button.tsx, the
 * label may wrap below 22.5rem (so with a large browser text size) and the button never grows past the form, so it cannot push the
 * page sideways; min-h keeps it 58 px tall at the default size and lets two lines fit.
 */
export function ZipForm({ id, lang = 'en' }: { id: string; lang?: Lang }) {
  return (
    <form action={lang === 'es' ? '/es/check' : '/check'} method="get" className="flex w-full max-w-[520px] flex-wrap gap-2.5">
      <label htmlFor={id} className="sr-only">
        {t(lang, 'zip.label')}
      </label>
      <input
        id={id}
        name="zip"
        inputMode="numeric"
        autoComplete="postal-code"
        maxLength={5}
        pattern="[0-9]{5}"
        title={t(lang, 'zip.title')}
        required
        placeholder={t(lang, 'zip.placeholder')}
        className="h-[58px] min-w-0 flex-[999_1_110px] rounded-control border-2 border-brand-line bg-brand-deep px-4 text-[1.1875rem] text-on-brand placeholder:text-on-brand-faint"
      />
      <button
        type="submit"
        className="min-h-[58px] max-w-full flex-[1_1_auto] cursor-pointer whitespace-normal rounded-control bg-signal px-6 text-lg font-semibold text-ink transition-[background-color,transform] duration-150 hover:bg-signal-hover active:translate-y-px min-[22.5rem]:whitespace-nowrap"
      >
        {t(lang, 'zip.button')}
      </button>
    </form>
  );
}
