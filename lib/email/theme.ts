/**
 * The one place for the look of every email Holler sends and of the token-link pages (lib/email/html-page.ts).
 * Values match the site tokens in app/globals.css (round 9: field green and hi-vis lime). Mail clients ignore class names and
 * most never load web fonts, so every style here is an inline string with a safe font fallback stack.
 *
 * Rule from the site: signal (lime) is only ever a fill on green with ink on it. Never text or an edge on a light surface.
 */
import { siteUrl } from '../env';

export const EMAIL_COLORS = {
  /** Page paper behind the card. */
  paper: '#F5F4EF',
  /** The card. */
  surface: '#FFFFFF',
  /** Body text. */
  ink: '#14201A',
  /** Secondary text on paper and on the card. */
  muted: '#5B635D',
  /** Decorative hairline around the card. */
  line: '#DEDCD2',
  /** Edge of a secondary button on white: the site's line-strong, 3.85:1 on surface and 3.49:1 on paper. */
  lineStrong: '#7C847E',
  /** Field green: the header band and the primary button. */
  brand: '#1E3A2C',
  /** Green text and links on light surfaces. */
  brandText: '#2E5A41',
  /** Text on green. */
  onBrand: '#F5F4EF',
  /** Hi-vis lime. Only ever a fill on green with ink on it. In email it appears only inside the mark image (public/email-mark.png). */
  signal: '#D9F046',
} as const;

/**
 * Dark-mode values for the alert digest (round 23). A client that honours prefers-color-scheme gets these through the one
 * `<style>` block the digest carries (digestDarkModeCss); every other client keeps the inline light values. Nothing here is lime:
 * the signal color is never text and never an edge, and in dark mode the primary fill is the lighter green (brandText) so the
 * button still reads as a button against the dark card.
 *
 * Contrast on darkSurface #17211C: ink #ECEFE9 about 13:1, muted #AEB7B0 about 7.4:1, link #9FD6B4 about 9:1. All over 4.5:1.
 */
export const EMAIL_DARK = {
  paper: '#101814',
  surface: '#17211C',
  line: '#2C3A32',
  ink: '#ECEFE9',
  muted: '#AEB7B0',
  link: '#9FD6B4',
  chip: '#21302A',
  chipLine: '#35463D',
  button: '#2E5A41',
  onButton: '#F5F4EF',
} as const;

export const EMAIL_FONTS = {
  body: "Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  /** Wordmark and headings. Always bold and uppercase. Web fonts rarely load in mail, so the fallbacks carry the look. */
  display: "'HelveticaNeue-CondensedBold','Avenir Next Condensed','Arial Narrow','Roboto Condensed',sans-serif-condensed,Arial,sans-serif",
  mono: "'JetBrains Mono', Menlo, Consolas, monospace",
} as const;

const C = EMAIL_COLORS;
const F = EMAIL_FONTS;

/** Inline style strings, shared by every template. */
export const EMAIL_STYLE = {
  /** Small secondary text (13 px is the smallest size we use). */
  small: `font-size:13px;color:${C.muted}`,
  /** Secondary paragraph. */
  muted: `font-size:14px;color:${C.muted}`,
  /** Link on the white card. */
  link: `color:${C.brandText}`,
  /** Link inside muted text. */
  mutedLink: `color:${C.muted}`,
  /** Mono eyebrow above a heading ("Holler for ..."). Brand green text, so the one green accent of the header repeats in the body. */
  eyebrow: `font-family:${F.mono};font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:${C.brandText}`,
  /**
   * Page heading in the condensed display stack. text-wrap:balance: clients that support it (Apple Mail, Chrome renders) do not
   * leave one word alone on the last line (final review B P2-6); others ignore it.
   */
  h1: `font-family:${F.display};font-weight:700;text-transform:uppercase;letter-spacing:0.01em;line-height:1.15;text-wrap:balance;color:${C.ink}`,
  /** Section heading inside the card (owner emails). Sentence case, body font. */
  h2: `font-family:${F.body};font-weight:600;color:${C.ink}`,
  /** Quoted block (request text). Edge in brand green, never lime. */
  quote: `border-left:3px solid ${C.brand};background:${C.paper};color:${C.ink}`,
} as const;

/** Path of the mark image under the site root (public/email-mark.png, made by scripts/email-mark.py: 60 px for 2x screens). */
export const EMAIL_MARK_PATH = '/email-mark.png';

/** Absolute URL of the mark, built from the same site URL every email link uses (lib/env siteUrl). Never a typed host. */
export function emailMarkUrl(base: string = siteUrl): string {
  return `${base.replace(/\/$/, '')}${EMAIL_MARK_PATH}`;
}

/**
 * Header band: the mark (30 px image of public/icon.svg) and the HOLLER wordmark on field green. The image has width and height
 * attributes and alt="", so when a client blocks images it keeps its 30 px box (or shows nothing) and the band keeps its height:
 * the band's height comes from the 30 px line box of the wordmark, not from the image. No empty lime tile is ever drawn in HTML.
 */
export function emailHeader(base: string = siteUrl): string {
  return (
    `<div style="background:${C.brand};border-radius:10px 10px 0 0;padding:14px 24px;line-height:30px">` +
    `<img src="${emailMarkUrl(base)}" width="30" height="30" alt="" style="display:inline-block;width:30px;height:30px;border:0;border-radius:6px;vertical-align:middle;margin:0 10px 0 0">` +
    `<span style="font-family:${F.display};font-size:26px;font-weight:700;text-transform:uppercase;letter-spacing:0.02em;line-height:30px;vertical-align:middle;color:${C.onBrand}">HOLLER</span>` +
    `</div>`
  );
}

/**
 * Opens an email: paper page, green header band, white card. Close with `cardClose()`, then the postal footer (which sits on the
 * paper under the card), then `WRAP_CLOSE`. The footer stays the last thing before the final `</div>` (tests rely on it).
 */
export function wrapOpen(maxWidth = 560, lang: 'en' | 'es' = 'en', classed = false): string {
  // `classed` (round 23, the alert digest) adds the two hooks the dark-mode style block needs. Off by default, so every other
  // email's bytes are exactly what they were.
  return (
    `<div${lang === 'en' ? '' : ` lang="${lang}"`}${classed ? ' class="h-page"' : ''} style="font-family:${F.body};max-width:${maxWidth}px;margin:0 auto;padding:16px;color:${C.ink};background:${C.paper};line-height:1.5">` +
    emailHeader() +
    `<div${classed ? ' class="h-card"' : ''} style="background:${C.surface};border:1px solid ${C.line};border-top:0;border-radius:0 0 10px 10px;padding:24px 20px">`
  );
}

export function cardClose(): string {
  return '</div>';
}

export const WRAP_CLOSE = '</div>';

/** Style of the primary button: green fill, paper text, 10 px radius, 44 px tall (13 + 18 + 13). */
export const PRIMARY_BUTTON_STYLE = `background:${C.brand};color:${C.onBrand};text-decoration:none;padding:13px 22px;line-height:18px;font-size:16px;min-height:44px;box-sizing:border-box;border-radius:10px;display:inline-block;font-weight:600;font-family:${F.body}`;

/** Style of the secondary button: white fill, ink text, a 3:1 edge, 44 px tall (1 + 12 + 18 + 12 + 1). */
export const SECONDARY_BUTTON_STYLE = `background:${C.surface};color:${C.ink};text-decoration:none;padding:12px 22px;line-height:18px;font-size:16px;min-height:44px;box-sizing:border-box;border-radius:10px;display:inline-block;font-weight:600;font-family:${F.body};border:1px solid ${C.lineStrong}`;

/** A primary button on its own line. `href` and `label` must already be HTML-escaped. */
export function buttonHtml(hrefEscaped: string, labelEscaped: string): string {
  return `<p style="margin:20px 0"><a href="${hrefEscaped}" style="${PRIMARY_BUTTON_STYLE}">${labelEscaped}</a></p>`;
}

// ---- the alert digest (round 23) ---------------------------------------------------------------------------------------------------

const D = EMAIL_DARK;

/**
 * The one `<style>` block the alert digest carries, for clients that read prefers-color-scheme (Apple Mail on macOS and iOS,
 * Outlook for Mac, Thunderbird). Every rule is a class the digest also sets inline, so a client that drops the block, or forces
 * its own inversion, still gets a readable light card. `color-scheme` tells Apple Mail not to re-invert what we already darkened.
 *
 * `.h-page > p` is the postal footer, which sits on the paper outside the card (lib/legal/email-footer.ts) and is the one
 * element the digest does not write a class on, so that file keeps its exact bytes for the frozen English fixtures.
 */
export function digestDarkModeCss(): string {
  return (
    '<style>' +
    ':root{color-scheme:light dark;supported-color-schemes:light dark}' +
    '@media (prefers-color-scheme:dark){' +
    `.h-page{background:${D.paper} !important}` +
    `.h-card,.h-item{background:${D.surface} !important;border-color:${D.line} !important}` +
    `.h-h1,.h-head,.h-ink,.h-why{color:${D.ink} !important}` +
    `.h-meta,.h-small,.h-page > p{color:${D.muted} !important}` +
    `.h-link{color:${D.link} !important}` +
    `.h-chip{background:${D.chip} !important;border-color:${D.chipLine} !important;color:${D.ink} !important}` +
    `.h-chip-strong{background:${D.button} !important;border-color:${D.button} !important;color:${D.onButton} !important}` +
    `.h-btn{background:${D.button} !important}` +
    `.h-btn a{color:${D.onButton} !important}` +
    `.h-quote{background:${D.surface} !important;border-left-color:${D.button} !important;color:${D.ink} !important}` +
    '}' +
    '</style>'
  );
}

/**
 * One alert card: a table, not a div, because Outlook on Windows lays email out with Word and gives a div no reliable padding,
 * border or radius. `role="presentation"` keeps it out of the accessibility tree, so a screen reader reads the card's own text in
 * order. Content must already be HTML-escaped.
 */
export function cardTableHtml(inner: string): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="h-item" style="width:100%;border-collapse:separate;background:${C.surface};border:1px solid ${C.line};border-radius:12px">` +
    `<tr><td style="padding:16px">${inner}</td></tr></table>`
  );
}

/**
 * The label chip ("Act now", "Coming soon"). A one-cell table so the pill keeps its padding in Outlook. `strong` fills it with
 * field green and paper text (an Act Now card); otherwise paper fill, ink text and a hairline edge: visible, not shouting.
 */
export function chipHtml(labelEscaped: string, strong = false): string {
  const fill = strong ? C.brand : C.paper;
  const ink = strong ? C.onBrand : C.ink;
  const edge = strong ? C.brand : C.line;
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr>` +
    `<td class="h-chip${strong ? ' h-chip-strong' : ''}" style="background:${fill};border:1px solid ${edge};border-radius:999px;padding:5px 11px;font-family:${F.body};font-size:12px;font-weight:700;line-height:14px;color:${ink}">${labelEscaped}</td>` +
    `</tr></table>`
  );
}

/**
 * The one action of a card: a table-cell button, 44 px tall (13 + 18 + 13), so the tap target holds in every client. `variant`
 * 'secondary' is the white-filled version with a 3:1 edge, for a second-rank card. Both strings must already be escaped.
 */
export function cardButtonHtml(hrefEscaped: string, labelEscaped: string, variant: 'primary' | 'secondary' = 'primary'): string {
  const primary = variant === 'primary';
  const fill = primary ? C.brand : C.surface;
  const ink = primary ? C.onBrand : C.ink;
  const edge = primary ? C.brand : C.lineStrong;
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0 0;border-collapse:separate"><tr>` +
    `<td class="h-btn" style="background:${fill};border:1px solid ${edge};border-radius:10px">` +
    `<a href="${hrefEscaped}" style="display:inline-block;padding:13px 20px;min-height:44px;box-sizing:border-box;font-family:${F.body};font-size:16px;font-weight:600;line-height:18px;color:${ink};text-decoration:none">${labelEscaped}</a>` +
    `</td></tr></table>`
  );
}
