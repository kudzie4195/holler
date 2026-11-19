/**
 * The ZIP check on green (hero and closing band). A plain GET form to /check with one field, `zip`; no client JavaScript.
 * /check with a ZIP and no trade shows its form with the ZIP filled in and asks for a trade (unit C).
 * Field: brand-deep fill, brand-line edge (4.17:1), on-brand text; the placeholder is on-brand-faint (7.8:1). Button: signal with ink.
 */
export function ZipForm({ id }: { id: string }) {
  return (
    <form action="/check" method="get" className="flex w-full max-w-[520px] flex-wrap gap-2.5">
      <label htmlFor={id} className="sr-only">
        ZIP code
      </label>
      <input
        id={id}
        name="zip"
        inputMode="numeric"
        autoComplete="postal-code"
        maxLength={5}
        pattern="[0-9]{5}"
        title="Five digits"
        required
        placeholder="ZIP code"
        className="h-[58px] min-w-0 flex-[999_1_110px] rounded-control border-2 border-brand-line bg-brand-deep px-4 text-[19px] text-on-brand placeholder:text-on-brand-faint"
      />
      <button
        type="submit"
        className="h-[58px] flex-[1_1_auto] cursor-pointer whitespace-nowrap rounded-control bg-signal px-6 text-lg font-semibold text-ink transition-[filter,transform] duration-150 hover:brightness-105 active:translate-y-px"
      >
        Check my area
      </button>
    </form>
  );
}
