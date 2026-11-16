import { readFileSync } from 'node:fs';
import path from 'node:path';

export function fixture(name: string): string {
  return readFileSync(path.resolve(__dirname, '../../fixtures', name), 'utf8');
}
