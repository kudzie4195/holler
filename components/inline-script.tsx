/**
 * An inline script that runs while the browser parses the HTML, before the first paint (node_modules/next/dist/docs/01-app/02-guides/
 * preventing-flash-before-hydration.md, "Extracting a reusable component"). text/javascript on the server; text/plain when React renders
 * it in the browser (a soft navigation), so it never runs twice. The site's CSP has no script-src (lib/security-headers.ts), so an inline
 * script is allowed without changing the policy.
 */
export function InlineScript({ html }: { html: string }) {
  return <script type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: html }} />;
}
