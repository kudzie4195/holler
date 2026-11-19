/** Class strings shared by the home page sections (Version 3). Tailwind utilities on the round 9 tokens only. */

/** Page column: 1200 px wide, 24 px gutters at every width. */
export const COL = 'mx-auto w-full max-w-[1200px] px-6';

/** Section headline: Barlow Condensed 700, upper case (the global h2 rule), 44 to 76 px. */
export const H2 = 'm-0 font-display text-[clamp(44px,5.6vw,76px)] leading-[0.95] text-balance';

/** The round mark with a number: green disc, signal numeral (9.7:1). */
export const MARK =
  'inline-flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-brand font-mono text-[13px] leading-none text-signal';

/** Family tag on light: mono 13 px on the family tint. */
export const TAG: Record<'weather' | 'permit' | 'civic', string> = {
  weather: 'bg-sky text-storm-ink',
  permit: 'bg-sage text-sage-ink',
  civic: 'bg-civic text-civic-ink',
};

/** Family mark (the dot) on light, and on green. */
export const MARK_LIGHT: Record<'weather' | 'permit' | 'civic', string> = {
  weather: 'bg-storm',
  permit: 'bg-sage-mark',
  civic: 'bg-civic-mark',
};
export const MARK_ON_BRAND: Record<'weather' | 'permit' | 'civic', string> = {
  weather: 'bg-weather-on-brand',
  permit: 'bg-permit-on-brand',
  civic: 'bg-civic-on-brand',
};

/** Shape per family, so the families never differ by color alone: permits square, 311 and code round, weather a drop. */
export const SHAPE: Record<'weather' | 'permit' | 'civic', string> = {
  permit: 'rounded-[3px]',
  civic: 'rounded-full',
  weather: 'rounded-[50%_50%_50%_0]',
};
