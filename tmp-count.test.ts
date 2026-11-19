import { ALL_ADAPTERS } from '@/lib/signals/registry';
const by: Record<string, number> = {};
for (const a of ALL_ADAPTERS) { const k = a.id.split(/[:-]/)[0] + '|' + a.kind + '|' + (a.requiresEnv?.join(',') ?? ''); by[k] = (by[k] ?? 0) + 1; }
console.log(ALL_ADAPTERS.length, by);
console.log(ALL_ADAPTERS.map(a=>a.id).join(' '));
