/**
 * Primary-User Office Location Cron Route
 *
 * Escape hatch for deployments that prefer an external scheduler over the
 * in-process timer in instrumentation.ts (which is what actually drives this
 * for the default self-hosted Docker setup). Both paths call the same
 * idempotent, resumable capture function, so enabling this too causes no
 * double-counting - it just picks up whatever's still missing for today.
 *
 * Uses a smaller internal budget than the in-process trigger: this path IS a
 * real HTTP request bound by a platform timeout (unlike instrumentation.ts's
 * background timer), so maxDuration must comfortably exceed it.
 */

import { NextResponse } from 'next/server';
import { captureDueOfficeLocations } from '@/lib/intune/user-office-location';
import { verifyCronSecret } from '@/lib/cron-auth';

const BUDGET_MS = 2 * 60 * 1000;

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await captureDueOfficeLocations(BUDGET_MS);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error running office-location cron:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Snapshot failed' },
      { status: 500 }
    );
  }
}
