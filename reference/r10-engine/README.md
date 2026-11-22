# reference/r10-engine (not part of the product)

Round 19 UNIFY merged the parallel branch (origin/main 61727f3, "Metro data: probation sources ..., opportunity retune, builders, zip waitlist (#7)") into this base. The product keeps ONE label engine: `lib/signals/lead-rules.ts` (act_now / coming_soon / market_insight / context) with `brief.ts`. The other branch's engine and the pieces that only work with its classifier are kept here UNCHANGED, at the paths they had, so a later unit can compare the two engines row by row.

Nothing here is built, typechecked, linted or run by `npx vitest run`: `tsconfig.json` and `eslint.config.mjs` exclude `reference/`, and vitest only includes `tests/**/*.test.ts`. Imports inside these files still point at their old locations and do not resolve from here. `tests/integration/r19-unify-boundaries.test.ts` fails if any product file imports them.

| Path here | What it is |
| --- | --- |
| `lib/signals/opportunity.ts`, `lib/signals/member-opportunity.ts` | their label engine (act / soon / intel / context) and its per-member wiring |
| `scripts/opportunity-replay.ts`, `scripts/match-replay.ts` | their replay scripts |
| `tests/signals/opportunity.test.ts`, `tests/signals/opportunity-surfaces.test.ts` | their engine tests (the "alert quality pass" expectations) |
| `nyc-agents/` | their NYC heat-complaint to managing-agent join (`nyc-hpd-agents` probation adapter); this base keeps `lib/signals/adapters/nyc-hpd.ts` |
| `contacts-classifier/` | their tests for the entity-marker change to `lib/contacts/org.ts`, which this base does not take |
| `contacts-round10/` | their contact-spec test for 15 permit sources and its fixtures; this base has its own specs for those sources |

To run one of these tests for a comparison, copy the engine files back under `lib/` in a throwaway worktree first.
