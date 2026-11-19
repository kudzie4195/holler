import { cleanPath, cleanToken, isSessionId } from './attr';

export const EVENT_NAMES = ['visit', 'area_check', 'signup', 'first_alert', 'trial_start', 'paid', 'app_open'] as const;
export type EventName = (typeof EVENT_NAMES)[number];
/** The three names POST /api/e accepts from a browser. The rest are written by the server only. */
export const BROWSER_EVENTS = ['visit', 'area_check', 'app_open'] as const;
export type BrowserEvent = (typeof BROWSER_EVENTS)[number];

export interface EventProps {
  userId?: string;
  sessionId?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  path?: string;
}

/** The exact columns of an inserted row. No IP, no user agent, no referrer: there is no key for them. */
export interface EventRow {
  name: EventName;
  session_id: string | null;
  user_id: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  path: string | null;
}
export const EVENT_ROW_KEYS = ['campaign', 'medium', 'name', 'path', 'session_id', 'source', 'user_id'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Builds the row from untrusted props. Every field is validated again here, whoever called. Returns null for an unknown name. */
export function buildEventRow(name: string, props: EventProps = {}): EventRow | null {
  if (!(EVENT_NAMES as readonly string[]).includes(name)) return null;
  return {
    name: name as EventName,
    session_id: isSessionId(props.sessionId) ? props.sessionId : null,
    user_id: typeof props.userId === 'string' && UUID.test(props.userId) ? props.userId.toLowerCase() : null,
    source: cleanToken(props.source),
    medium: cleanToken(props.medium),
    campaign: cleanToken(props.campaign),
    path: cleanPath(props.path),
  };
}
