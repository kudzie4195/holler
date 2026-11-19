import { it } from 'vitest';
import { pricingProse } from './copy-rules.test';
import { sentences, wordCount } from '../seo/helpers/copy-metrics';
import { stripLinks } from '../../lib/seo/guides/inline';
it('dump', () => { for (const s of sentences(stripLinks(pricingProse()))) console.log(`DUMP ${wordCount(s)} | ${s}`); });
