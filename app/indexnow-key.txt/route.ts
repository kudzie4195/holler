import { connection } from 'next/server';
import { env } from '@/lib/env';
import { isValidKey } from '@/lib/seo/indexnow';

/**
 * IndexNow key file (https://www.indexnow.org/documentation): UTF-8 text that contains exactly the key. The pings send
 * keyLocation = <site>/indexnow-key.txt. 404 when INDEXNOW_KEY is unset or not a valid key (8 to 128 of a-z, A-Z, 0-9, dash).
 * connection() makes it read the key at request time instead of freezing the build-time value.
 */
export async function GET() {
  await connection();
  const key = env.INDEXNOW_KEY?.trim();
  if (!isValidKey(key)) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex' } });
  return new Response(key, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
