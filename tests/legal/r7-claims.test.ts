// Round 7: every new statement on /privacy and /terms is pinned here next to the code fact that makes it true. If the code changes,
// the matching check fails and points at the sentence to fix. One `it` per topic of the brief (gates/r7 legal unit).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderLegal, src } from './render-helper';
import { COOKIE_MAX_AGE, SID_COOKIE, SRC_COOKIE } from '@/lib/analytics/attr';
import { SKIP_SOURCES, toRecord } from '@/lib/ai/classify';
import { DRAFT_MODEL } from '@/lib/ai/draft';
import { TRIAL_DAYS } from '@/lib/plan/public-prices';

vi.mock('@/components/doc-page', async () => (await import('./render-helper')).docPageMock());
afterEach(() => vi.unstubAllEnvs());

const MIG = (n: string) => src(`supabase/migrations/${n}`);

describe('privacy: the mobile app', () => {
  it('session on the device, push token, FCM, lock screen content, how to turn off', async () => {
    const { text } = await renderLegal('privacy');
    expect(text).toContain('the Holler app for iPhone and Android');
    expect(text).toContain(
      'The app keeps your sign-in session in its own storage on your phone, with a backup copy so a short outage on the sign-in service does not sign you out.',
    );
    // Round 7 mobile fixes: the session store is wrapped by auth/guard.ts, which copies every saved session to its own backup key.
    const sb = src('mobile/src/auth/supabase.ts');
    expect(sb).toContain("const STORAGE_KEY = 'holler-auth';");
    expect(sb).toContain('storage: isNative() ? preferencesStorage : webStorage(),');
    expect(sb).toContain('storageKey: STORAGE_KEY,');
    const guard = src('mobile/src/auth/guard.ts');
    expect(guard).toContain("export const BACKUP_SUFFIX = '-backup';");
    expect(guard).toContain('const backupKey = storageKey + BACKUP_SUFFIX;');
    expect(guard).toMatch(/async setItem\(key, value\) \{[\s\S]*?await base\.setItem\(backupKey, value\);/);
    expect(text).toContain('Signing out removes both.');
    // Our own sign-out starts and ends in the guard: the backup goes first, then the session and the backup are both removed.
    expect(src('mobile/src/state/AppContext.tsx')).toContain('await guard.beginSignOut()');
    expect(src('mobile/src/state/AppContext.tsx')).toContain('await guard.endSignOut()');
    expect(guard).toMatch(/async endSignOut\(\) \{[\s\S]*?await base\.removeItem\(storageKey\);\s*await base\.removeItem\(backupKey\);/);
    // Sign-out goes through releaseMember (mobile/src/state/member.ts) since the round 7 mobile fixes; it still drops the session.
    expect(src('mobile/src/state/AppContext.tsx')).toContain("signOutSupabase: async () => void (await supabase().auth.signOut({ scope: 'local' }))");
    expect(src('mobile/src/state/member.ts')).toContain('await deps.signOutSupabase();');
    // No location, contacts or photo plugin in the app.
    const deps = Object.keys(JSON.parse(src('mobile/package.json')).dependencies as Record<string, string>);
    expect(deps.filter((d) => /geoloc|contacts|camera|photo|media/i.test(d))).toEqual([]);
    expect(text).toContain('The app never reads your location, contacts or photos.');
    // Token, platform and app version stored with the account (0020).
    expect(text).toContain('We store that token with your account, the kind of phone and the app version');
    expect(MIG('0020_holler_mobile.sql')).toMatch(/user_id uuid not null[\s\S]*token text not null,\s*platform text not null,\s*app_version text/);
    expect(text).toContain("Google's Firebase Cloud Messaging delivers each push, on iPhone and on Android.");
    expect(src('lib/push/fcm.ts')).toContain('Firebase Cloud Messaging HTTP v1 sender (one sender for iOS and Android)');
    expect(deps).toContain('@capacitor-firebase/messaging');
    // Push content: count and city in the title, the public signal title in the body.
    expect(text).toContain('A push shows the city and the title of a public record');
    expect(src('lib/push/notify.ts')).toContain('return { title, body: truncate(topTitle), data };');
    expect(text).toContain("Turn pushes off with the switch in the app's Settings, or in your phone's settings.");
    expect(src('mobile/src/screens/Settings.tsx')).toContain('label="Push notifications"');
    expect(text).toContain("Signing out removes that phone's token.");
    expect(src('mobile/src/state/AppContext.tsx')).toContain('await releaseMember({ push,');
    expect(src('mobile/src/state/member.ts')).toContain('await deps.push.unregister()');
  });

  it('sign in with Apple and Google: what Holler gets', async () => {
    const { text } = await renderLegal('privacy');
    expect(text).toContain('In the app you can also sign in with Apple, or with Google where the app offers it.');
    expect(text).toContain('Then we get your email address and an ID that Apple or Google uses for you. Apple or Google may also share your name.');
    const social = src('mobile/src/auth/social.ts');
    expect(social).toContain('scopes: [SignInScope.Email, SignInScope.FullName]');
    expect(social).toContain("signInWithOAuth");
    expect(text).toContain('Holler does not show your name or use it.');
    // The web app never reads the name the provider sends.
    for (const f of ['lib/auth/profile.ts', 'lib/mobile/account.ts', 'app/api/m/me/route.ts']) expect(src(f)).not.toMatch(/full_name|user_metadata/);
  });

  it('store purchases: Apple or Google bills, RevenueCat records, no card, no name or email to RevenueCat', async () => {
    const { text } = await renderLegal('privacy');
    expect(text).toContain('In the app, Apple or Google handles payment, under its own terms. RevenueCat records the purchase for us.');
    expect(text).toContain('We give RevenueCat your Holler account number. We do not give it your name or email.');
    const purchases = src('mobile/src/purchases/purchases.ts');
    expect(purchases).toContain('appUserID: userId');
    expect(purchases).not.toMatch(/setEmail|setDisplayName|setAttributes/);
    expect(text).toContain('From RevenueCat we keep the store, the product, the price, and the purchase and renewal dates.');
    const rc = src('lib/storebilling/revenuecat.ts');
    for (const k of ["'store'", "'product_id'", "'price'", "'purchased_at_ms'", "'expiration_at_ms'"]) expect(rc).toContain(k);
    expect(rc).toContain('no subscriber attributes, aliases, emails, country, or transaction ids');
  });
});

describe('privacy: AI processing', () => {
  it('names the fields the model sees, the providers, the skipped sources, and that results can be wrong', async () => {
    const { text } = await renderLegal('privacy');
    // Review r3 P2 (c): "Anthropic's Claude" was true only while AI_CLASSIFY_MODEL is unset. tests/legal/r3-legal.test.ts pins the
    // new wording and that only Anthropic models can run.
    expect(text).toContain("We use an AI model from Anthropic, through Vercel's AI Gateway, to sort new public records by trade");
    expect(DRAFT_MODEL.startsWith('anthropic/')).toBe(true);
    expect(src('lib/ai/classify.ts')).toContain("export const DEFAULT_CLASSIFY_MODEL = 'anthropic/");
    expect(text).toContain(
      'The model sees only parts of the public record: its title, a short summary, its type and source, the city and state, and the trades our keyword rules already picked.',
    );
    // toRecord is the only builder of model input: these keys and nothing else.
    const r = toRecord({
      id: 1, kind: 'permit', subtype: 'roof', source: 'x', title: 't', summary: 's', city: 'c', state: 'GA', categories: ['roofing'],
      // Extra fields a signal row can carry must never pass through.
      ...({ url: 'https://u', lat: 1, lon: 2, zip: '30064', contacts: [{ name: 'n' }], email: 'e@x.y' } as object),
    } as Parameters<typeof toRecord>[0]);
    expect(Object.keys(r).sort()).toEqual(['city', 'id', 'kind', 'rule', 'source', 'state', 'subtype', 'summary', 'title']);
    expect(text).toContain('Weather alerts, storm reports, disaster declarations, earthquakes and airport delays are not sent at all.');
    expect([...SKIP_SOURCES].sort()).toEqual(['faa', 'fema', 'holler-request', 'nws', 'spc', 'usgs']);
    // Review r3 P2 (d): requests are skipped entirely (SKIP_SOURCES), so nothing from one reaches the model.
    expect(text).toContain('Resident requests are not sent either. Nothing from a request reaches the model.');
    expect(text).toContain('It runs on a schedule, not when you open a page. Its sorting can be wrong. So can its notes.');
    // Classification is reached only from the cron route: no page or member route imports lib/ai/classify. Reply drafts
    // (lib/ai/draft.ts, app/api/draft) are the member-triggered path, under the same cap (tests/draft).
    const { execSync } = await import('node:child_process');
    const importers = execSync("grep -rl \"lib/ai/classify'\" app components lib || true", { cwd: (await import('node:path')).resolve(__dirname, '../..'), encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .filter((f) => !f.startsWith('lib/ai/'));
    expect(importers).toEqual(['app/api/cron/ai/route.ts']);
  });
});

describe('privacy: the language cookie (round 18 ES)', () => {
  it('names holler_lang, says it holds only en or es, one year, not for tracking, and that logging out or deleting the account removes it', async () => {
    const { text } = await renderLegal('privacy');
    const { LANG_COOKIE, LANG_COOKIE_MAX_AGE } = await import('@/lib/auth/lang-cookie');
    expect(LANG_COOKIE).toBe('holler_lang');
    expect(LANG_COOKIE_MAX_AGE).toBe(365 * 24 * 60 * 60);
    expect(text).toContain('Your browser also gets a cookie, holler_lang, that holds only en or es and remembers the language of your account pages in this browser for one year; it is not used for tracking, and logging out or deleting your account removes it.');
  });
});

describe('privacy: first-party counting', () => {
  it('two cookies, their contents, 30 days, no IP or device data, GPC and DNT, account steps always', async () => {
    const { text } = await renderLegal('privacy');
    expect([SID_COOKIE, SRC_COOKIE]).toEqual(['holler_sid', 'holler_src']);
    expect(COOKIE_MAX_AGE).toBe(30 * 24 * 60 * 60);
    expect(text).toContain('a small script sets two first party cookies, each kept for 30 days');
    expect(text).toContain('The first, holler_sid, holds a random ID and the date of your last counted visit.');
    expect(text).toContain('The second, holler_src, holds where you came from.');
    expect(text).toContain('It never holds your IP address. It never holds your browser or device details, or the page that sent you.');
    const sql = MIG('0017_holler_analytics.sql');
    const table = sql.slice(sql.indexOf('create table if not exists public.holler_events'), sql.indexOf(');', sql.indexOf('create table if not exists public.holler_events')));
    expect(table).not.toMatch(/\bip\b|user_agent|referr/i);
    expect(text).toContain('If your browser sends Global Privacy Control or Do Not Track, we set neither cookie.');
    expect(src('lib/analytics/attr.ts')).toContain('on(nav?.globalPrivacyControl) || on(nav?.doNotTrack)');
    expect(text).toContain('Account steps are still recorded, because they are part of running your account.');
    // Review r3 P0: visit counts are not deleted with the account (no user_id on them); account steps are. Weekly 400-day prune.
    expect(text).toContain('Account steps: about 13 months, and deleted with your account.');
    expect(text).toContain('Visit and area check counts: about 13 months. They hold no account number, so deleting your account does not remove them.');
    expect(sql).toContain('create or replace function public.holler_events_prune(p_days');
    expect(text).toContain('These counters are deleted after about two days.');
    expect(text).toContain('visit counts');
    expect(src('lib/analytics/ingest.ts')).toContain("rateKey('event', 'ip', ip)");
  });
});

describe('privacy: outcomes, archive and deletion', () => {
  it('outcome buttons, optional amount, follow-up ask, alert log columns, no sale with identity', async () => {
    const { text } = await renderLegal('privacy');
    expect(text).toContain('Each alert has buttons to say it was useful, not relevant, or led to work.');
    expect(MIG('0009_holler_signal_feedback.sql')).toContain("check (verdict in ('useful', 'not_relevant', 'led_to_work'))");
    expect(text).toContain('If it led to work, you can add the job amount.');
    expect(MIG('0009_holler_signal_feedback.sql')).toContain('job_value_usd int,');
    expect(text).toContain('A week or more after you mark an alert useful, we may ask once if it led to work.');
    expect(src('lib/moat/outcome.ts')).toContain('export const ASK_AFTER_DAYS = 7;');
    expect(text).toContain('Each line holds the record type, its source and severity, the trade, a distance band, your plan and when we emailed it.');
    const log = MIG('0015_holler_moat.sql');
    const logTable = log.slice(log.indexOf('create table if not exists public.holler_alert_log'), log.indexOf('constraint holler_alert_log_user_signal_key'));
    expect(logTable).not.toMatch(/\btitle\b|summary|address|\burl\b/);
    expect(text).toContain('We never sell your answers with your name or account attached.');
  });

  it('120-day records, coarse archive columns in plain words, resident requests never archived', async () => {
    const { text } = await renderLegal('privacy');
    expect(text).toContain('We keep full records for about 120 days, then delete them.');
    expect(text).toContain(
      'It holds only the source, the record type and subtype, the trades, the ZIP code, county, city and state, the date and a severity level.',
    );
    const sql = MIG('0015_holler_moat.sql');
    const archive = sql.slice(sql.indexOf('create table if not exists public.holler_signal_archive'), sql.indexOf('constraint holler_signal_archive_signal_key'));
    const cols = [...archive.matchAll(/^\s{2}([a-z_]+)\s/gm)].map((m) => m[1]);
    expect(cols).toEqual(['id', 'signal_id', 'source', 'kind', 'subtype', 'categories', 'zip', 'county', 'city', 'state', 'occurred_on', 'severity', 'archived_at']);
    expect(text).toContain('Resident requests are never kept this way.');
    expect(sql).toMatch(/holler-request/);
  });

  it('every member row the deletion removes has its trigger in the SQL, and the page lists it', async () => {
    const { text } = await renderLegal('privacy');
    const triggers: [string, string, string][] = [
      ['0005_holler_requests.sql', 'holler_profiles_delete_replies', 'delete from public.holler_request_replies where user_id = old.user_id'],
      ['0008_holler_feature_interest.sql', 'holler_profiles_delete_interest', 'delete from public.holler_feature_interest where user_id = old.user_id'],
      ['0009_holler_signal_feedback.sql', 'holler_profiles_delete_feedback', 'delete from public.holler_signal_feedback where user_id = old.user_id'],
      ['0015_holler_moat.sql', 'holler_profiles_delete_moat', 'delete from public.holler_alert_log where user_id = old.user_id'],
      ['0015_holler_moat.sql', 'holler_profiles_delete_moat', 'delete from public.holler_outcome_asks where user_id = old.user_id'],
      ['0016_holler_lifecycle.sql', 'holler_profiles_delete_lifecycle', 'delete from public.holler_lifecycle_sends where user_id = old.user_id'],
      ['0017_holler_analytics.sql', 'holler_profiles_delete_analytics', 'delete from public.holler_events where user_id = old.user_id'],
      ['0017_holler_analytics.sql', 'holler_profiles_delete_analytics', 'delete from public.holler_attribution where user_id = old.user_id'],
      ['0020_holler_mobile.sql', 'holler_profiles_delete_mobile', 'delete from public.holler_push_tokens where user_id = old.user_id'],
      ['0020_holler_mobile.sql', 'holler_profiles_delete_mobile', 'update public.holler_billing_events set user_id = null where user_id = old.user_id'],
    ];
    for (const [file, trig, stmt] of triggers) {
      const sql = MIG(file);
      expect(sql, `${file} ${trig}`).toContain(`create trigger ${trig}\n  after delete on public.holler_profiles`);
      expect(sql, `${file} ${stmt}`).toContain(stmt);
    }
    // Matches (with drafts) and the profile are deleted by the shared code.
    expect(src('lib/mobile/account.ts')).toContain("admin.from('holler_matches').delete().eq('user_id', userId)");
    // The web Settings action runs the same shared steps (the app's account delete route does too).
    expect(src('app/app/settings/actions.ts')).toContain('await deleteHollerAccount({ admin, userId: user.id, stripe: getStripe(), profile })');
    expect(text).toContain(
      // Review r3 P0: "visit and step counts" became "account steps" (visit counts carry no account number and age out).
      'It also deletes your feature picks, your feedback and answers, your alert log, your account steps, your source tag, your trial email record and your push tokens.',
    );
    expect(text).toContain('App store billing events: kept as billing records. When you delete your account, we remove your account number from them.');
    expect(text).toContain('We cannot cancel a plan you bought in the app. Cancel it in your Apple ID or Google Play subscription settings.');
    expect(src('lib/mobile/account.ts')).toContain('A live App Store or Google Play plan cannot be canceled from here');
    expect(text).toContain('Named in a record? Write to support@localholler.com with the link to the page.');
    expect(text).toContain('not directed to children under 13');
  });
});

describe('privacy: emails', () => {
  it('three trial emails with a no-login stop link, the weekly follow-up tied to alert emails', async () => {
    const { text } = await renderLegal('privacy');
    expect(text).toContain('Up to three emails about your free trial: about a day after you sign up, about three days before the trial ends, and about a day after it ends. If we extend your trial, the last two can come again for the new end date.');
    // lib/lifecycle/select.ts windows: welcome 20 to 44 h after signup, trial_ending 36 to 84 h before the end, sent at about 84 h (round 18; was 36 to 60), trial_ended 18 to 48 h after.
    const sel = src('lib/lifecycle/select.ts');
    expect(sel).toContain('welcome: { from: 20, to: 44 }');
    expect(sel).toContain('trial_ending: { from: 36, to: 84 }');
    expect(sel).toContain('trial_ended: { from: 18, to: 48 }');
    expect(MIG('0016_holler_lifecycle.sql')).toContain("check (kind in ('welcome', 'trial_ending', 'trial_ended', 'optout'))");
    expect(text).toContain("Each has a link to stop them that needs no login, and your mail app's unsubscribe button works too.");
    expect(src('lib/lifecycle/run.ts') + src('lib/lifecycle/templates.ts')).toMatch(/List-Unsubscribe-Post/);
    expect(text).toContain('It comes at most once a week, and only while email alerts are on.');
    expect(src('lib/moat/outcome.ts')).toContain('export const EMAIL_GAP_DAYS = 7;');
  });
});

describe('terms: round 7', () => {
  it('plans from constants, web and store billing, AI notes, push consent, app store clauses', async () => {
    const { text } = await renderLegal('terms');
    expect(text).toContain(`A new account gets a ${TRIAL_DAYS}-day free trial, on the website or in the app.`);
    expect(text).toContain('If you buy a plan in the app during your trial, Apple or Google charges you when you buy it.');
    expect(text).toContain('Manage it where you bought it.');
    expect(text).toContain('While a plan bought on the website is active, the app does not sell you a second one.');
    expect(MIG('0020_holler_mobile.sql')).toContain("v_result := 'other_store';");
    expect(text).toContain('Cancel in your Apple ID or Google Play subscription settings. Deleting your Holler account does not cancel it.');
    expect(text).toContain('Refunds for plans bought in the app are handled by Apple or Google, under their rules. We cannot issue them, so ask the store that billed you.');
    expect(text).toContain('It is not a lead or a customer request.');
    expect(text).toContain('The sorting and the notes are guesses from the public record. They can be wrong.');
    expect(text).toContain('Respect no-soliciting signs, do-not-knock lists and local rules on door-to-door sales.');
    expect(text).toContain('National Do Not Call Registry');
    expect(text).toContain('We send at most one an hour.');
    expect(src('lib/push/notify.ts')).toContain('at most one per member per hour');
    expect(text).toContain("To stop them, turn off Push notifications in the app's Settings");
    expect(text).toContain('These terms are between you and us. They are not with Apple or Google.');
    expect(text).toContain('Apple and Google have no duty to give support or upkeep for the app.');
    expect(text).toContain('on an Apple or Android device you own or control');
    expect(text).toContain('Apple and its subsidiaries may enforce these terms against you as third-party beneficiaries.');
    expect(text).toContain('Holler does not promise you any job, customer or income.');
  });
});
