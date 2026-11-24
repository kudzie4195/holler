'use server';

import { profileCoverage, type ProfileCoverage } from './profile-coverage';
import type { Lang } from '@/lib/i18n';

/**
 * Round 24 FIX2 (review D2): the onboarding and Settings forms ask this as the member types a ZIP or picks a trade. Pure: no database, no
 * write, no cookie; the same public answer /check gives for the same ZIP and trade. Inputs are checked in profileCoverage.
 */
export async function profileCoverageAction(zip: string, trades: string[], lang: string): Promise<ProfileCoverage | null> {
  const l: Lang = lang === 'es' ? 'es' : 'en';
  if (typeof zip !== 'string' || !Array.isArray(trades)) return null;
  return profileCoverage(zip.slice(0, 5), trades.slice(0, 12), l);
}
