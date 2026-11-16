/** Serialize for a <script type="application/ld+json"> tag; escapes "<" so titles cannot close the tag. */
export function jsonLdString(data: Record<string, unknown> | Record<string, unknown>[]): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
