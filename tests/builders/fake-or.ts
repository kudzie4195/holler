/* eslint-disable @typescript-eslint/no-explicit-any */
import { FakeDb } from '../ops/fakedb';

// Adds the PostgREST `.or('a,and(b,c)')` filter (only gte, lt, is.null, in.(..)) to the shared FakeDb builder, for the builders loader tests.
const split = (s: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
};

type Row = Record<string, any>;
function parse(term: string): (r: Row) => boolean {
  const and = /^and\((.*)\)$/.exec(term);
  if (and) {
    const ps = split(and[1]).map(parse);
    return (r) => ps.every((p) => p(r));
  }
  const m = /^([a-z_]+)\.(gte|lt|is|in)\.(.*)$/.exec(term);
  if (!m) throw new Error(`fake or: cannot parse ${term}`);
  const [, col, op, val] = m;
  if (op === 'is') return (r) => r[col] == null;
  if (op === 'in') {
    const set = val.replace(/^\(|\)$/g, '').split(',');
    return (r) => r[col] != null && set.includes(String(r[col]));
  }
  const n = Number(val);
  return op === 'gte' ? (r) => r[col] != null && r[col] >= n : (r) => r[col] != null && r[col] < n;
}

const proto = Object.getPrototypeOf(new FakeDb().from('x')) as any;
if (!proto.or) {
  proto.or = function (this: any, expr: string) {
    const ps = split(expr).map(parse);
    this.filters.push((r: Row) => ps.some((p) => p(r)));
    return this;
  };
}
