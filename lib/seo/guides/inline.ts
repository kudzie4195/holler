export type Inline = { text: string; href?: string };

const LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Split "text [label](href) text" into parts. Anything that is not a link stays plain text. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of src.matchAll(LINK)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: src.slice(last, at) });
    out.push({ text: m[1], href: m[2] });
    last = at + m[0].length;
  }
  if (last < src.length) out.push({ text: src.slice(last) });
  return out;
}

/** The visible text of a string, links reduced to their labels. */
export function stripLinks(src: string): string {
  return src.replace(LINK, '$1');
}

export function linksIn(src: string): { label: string; href: string }[] {
  return [...src.matchAll(LINK)].map((m) => ({ label: m[1], href: m[2] }));
}

export function isExternal(href: string): boolean {
  return /^https:\/\//.test(href);
}
