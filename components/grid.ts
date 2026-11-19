/**
 * The one page grid for the whole site: a 1200 px content box with a 24 px gutter at every width, centred in the window.
 * The logo, every page title, the green band content, the body and the footer start at its left edge. A reading page keeps a
 * narrow measure by nesting a max-width box inside it, never by centring a narrower box, so its column starts at the same edge.
 */
export const PAGE_BOX = 'mx-auto w-full max-w-[1200px] px-6';

/**
 * Body text size of every public page, the same 17 px (in rem, so text zoom scales it) as the homepage's <main>. Put on the
 * <main> of a page shell; children inherit it. Tables, captions and mono labels keep their own smaller sizes.
 */
export const BODY_TEXT = 'text-[1.0625rem]';
