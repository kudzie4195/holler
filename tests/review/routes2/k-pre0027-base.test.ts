// Round 18 ROUTES redo 2 (review 2, P1-1 and decision 1): with migration 0027 NOT applied the contact gate is completely inert. The same
// scenario, run on the base commit 8bee203, recorded what was stored, sent, re-armed for a stage update and logged (base-8bee203.json).
// Here it must be identical, for both error-code families, with stage updates on and off. With BASE_OUT set, it writes the result there
// instead (that is how the base file was made, on a checkout of 8bee203).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FAMILIES, runPre0027Scenario } from './pre0027-scenario';

// Round 19 integration (step 3): the base is now the rules branch r19-rules 9610e98 (no round 18 code, the round 19 label rules), written
// with BASE_OUT on a checkout of it. The 8bee203 file stays for the record: the two differ only by the round 19 label rules (member m2's
// trades lose four ADDR permits), which is the rules unit's intended change, not the gate's.
const BASE = join(__dirname, 'base-9610e98.json');

describe('0027 not applied: identical to the base (8bee203, re-recorded on r19-rules 9610e98 at the round 19 integration)', () => {
  for (const stageOn of [true, false]) {
    for (const fam of FAMILIES) {
      it(`${fam.name} codes, stage updates ${stageOn ? 'on' : 'off'}`, async () => {
        const got = await runPre0027Scenario(fam, stageOn);
        if (process.env.BASE_OUT) {
          const all = existsSync(process.env.BASE_OUT) ? JSON.parse(readFileSync(process.env.BASE_OUT, 'utf8')) : {};
          all[`stage-${stageOn ? 'on' : 'off'}`] = got;
          writeFileSync(process.env.BASE_OUT, JSON.stringify(all, null, 1));
          return;
        }
        const base = JSON.parse(readFileSync(BASE, 'utf8'))[`stage-${stageOn ? 'on' : 'off'}`];
        expect(got).toEqual(base);
        // and what it means: every permit was sent, logged and (stage on) updated, including those with no contact path
        expect(got.afterScan.every((m: { keys: string }) => !m.keys.includes('alert_hold'))).toBe(true);
        if (stageOn) expect(got.rearmed.some((k: string) => k.includes('NOPATH'))).toBe(true);
      });
    }
  }
});
