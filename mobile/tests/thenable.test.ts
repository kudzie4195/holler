// No Capacitor plugin may be RETURNED through a promise (it is a thenable Proxy; the promise would
// never settle). Pinned by reading the source: every loader returns a box like { Browser }.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../src');
const PLUGINS = ['Browser', 'Purchases', 'FirebaseMessaging', 'AppleSignIn', 'Preferences', 'App', 'StatusBar', 'CapacitorHttp'];

function files(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(SRC, f));
}

describe('Capacitor thenable trap', () => {
  it('no source file returns a bare plugin or resolves a promise with one', () => {
    const bad: string[] = [];
    const re = new RegExp(String.raw`return\s+(?:\w+(?:\?)?\.)?(${PLUGINS.join('|')})\s*;|resolve\(\s*(?:\w+\.)?(${PLUGINS.join('|')})\s*\)|=>\s*(?:\w+\.)?(${PLUGINS.join('|')})\s*\)`);
    for (const f of files()) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (re.test(line)) bad.push(`${path.relative(SRC, f)}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(bad).toEqual([]);
  });

  it('the pattern catches the bug it is meant to catch', () => {
    const re = /return\s+(?:\w+(?:\?)?\.)?(Purchases|Browser)\s*;/;
    expect(re.test('  return mod?.Purchases;')).toBe(true);
    expect(re.test('  return Browser;')).toBe(true);
    expect(re.test('  return { Browser };')).toBe(false);
  });
});
