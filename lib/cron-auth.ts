/**
 * Shared auth guard for Vercel Cron / manual cron-trigger routes.
 */

import crypto from 'crypto';

/**
 * Verify a cron request's Authorization header against CRON_SECRET, using a
 * timing-safe comparison. Fails closed (returns false) when CRON_SECRET is
 * unset, instead of comparing against the literal string "Bearer undefined"
 * (or "Bearer " for the self-hosted docker-compose.yml default of an empty
 * string) - previously an unset secret meant every cron route accepted an
 * unauthenticated request with a trivially-guessable Authorization header.
 */
export function verifyCronSecret(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[Cron] CRON_SECRET is not configured; rejecting request');
    return false;
  }

  const authHeader = request.headers.get('authorization');
  if (!authHeader) {
    return false;
  }

  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const actual = Buffer.from(authHeader);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}
