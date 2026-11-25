/**
 * Round 34 switch audit: the pure part of scripts/check-client-switches.ts (unit tested in tests/ops/client-switches.test.ts).
 *
 * A browser chunk that still names a server variable (`process.env.HOLLER_X`, `process.env?.HOLLER_X`, `process.env["HOLLER_X"]`, or the
 * name kept as a string for a `process.env[FLAG]` lookup) reads it at runtime, where it is always undefined: the browser then disagrees
 * with the server whenever the owner sets it. An inlined switch leaves no name behind (Next writes the value in its place), so ANY
 * occurrence of a listed name in a browser chunk is a failure.
 */
import { ENV_KEYS } from './env';

/** Every server variable the check looks for: each ENV_KEYS name except NEXT_PUBLIC_* (those are inlined by Next on purpose). */
export function serverEnvNames(keys: readonly string[] = ENV_KEYS): string[] {
  return keys.filter((k) => !k.startsWith('NEXT_PUBLIC_'));
}

export interface ChunkHit {
  file: string;
  name: string;
  /** True when the text around the name is an env read (`env.NAME`, `env?.NAME`, `env["NAME"]`); false for a bare mention. Both fail. */
  envRead: boolean;
  context: string;
}

/** Every occurrence of a listed name in one chunk's text, whole word only. */
export function chunkHits(file: string, text: string, names: readonly string[]): ChunkHit[] {
  const hits: ChunkHit[] = [];
  for (const name of names) {
    const re = new RegExp(`(?<![A-Za-z0-9_$])${name}(?![A-Za-z0-9_$])`, 'g');
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0;
      const before = text.slice(Math.max(0, at - 8), at);
      hits.push({
        file,
        name,
        envRead: /env(?:\?\.|\.|\[["'`]|\?\.\[["'`])$/.test(before),
        context: text.slice(Math.max(0, at - 80), at + name.length + 40).replace(/\s+/g, ' '),
      });
    }
  }
  return hits;
}
