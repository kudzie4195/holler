/**
 * Test helper (round 18, ES): renders a server-component tree to static HTML the way the page would stream it once every async part has
 * resolved. Async server components are awaited and replaced by what they return; sync server components are expanded only to reach an
 * async child inside them; client components (anything that calls a hook) are left for react-dom to render. A Suspense boundary is
 * kept, with its resolved children, so the markup is the final page, not the fallback.
 */
import { Fragment, cloneElement, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

type Fn = (props: unknown) => unknown;
const isAsync = (f: unknown) => typeof f === 'function' && (f as Fn).constructor?.name === 'AsyncFunction';

function hasAsyncInside(node: unknown, depth = 0): boolean {
  if (depth > 60) return false;
  if (Array.isArray(node)) return node.some((n) => hasAsyncInside(n, depth + 1));
  if (!isValidElement(node)) return false;
  if (isAsync(node.type)) return true;
  const props = node.props as { children?: ReactNode; fallback?: ReactNode };
  return hasAsyncInside(props.children, depth + 1);
}

export async function resolveTree(node: unknown, depth = 0): Promise<ReactNode> {
  if (depth > 200) throw new Error('resolveTree: too deep');
  if (node instanceof Promise) return resolveTree(await node, depth + 1);
  if (Array.isArray(node)) return Promise.all(node.map((n) => resolveTree(n, depth + 1))) as Promise<ReactNode>;
  if (!isValidElement(node)) return node as ReactNode;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (isAsync(el.type)) return resolveTree(await (el.type as Fn)(el.props), depth + 1);
  if (typeof el.type === 'function') {
    // A sync component: expand it only when it is a server component (no hooks). A client component throws here and is left as is.
    try {
      const out = (el.type as Fn)(el.props);
      if (hasAsyncInside(out) || isValidElement(out) || Array.isArray(out)) {
        const resolved = await resolveTree(out, depth + 1);
        return createElement(Fragment, null, resolved);
      }
      return el;
    } catch {
      return el;
    }
  }
  const children = el.props.children;
  if (children === undefined) return el;
  const resolved = await resolveTree(children, depth + 1);
  return cloneElement(el, undefined, resolved);
}

export async function renderResolved(node: unknown): Promise<string> {
  return renderToStaticMarkup(createElement(Fragment, null, await resolveTree(node)));
}
