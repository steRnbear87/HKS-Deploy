/**
 * Fleet Health Snapshot Cron Route
 *
 * Escape hatch for deployments that prefer an external scheduler over the
 * in-process timer in instrumentation.ts (which is what actually drives this
 * for the default self-hosted Docker setup). Both paths call the same
 * idempotent capture function, so enabling this too causes no double-counting.
 */

import { NextResponse } from 'next/server';
import { captureDueDeviceHealthSnapshots } from '@/lib/device-health/snapshot';

export const maxDuration = 300;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await captureDueDeviceHealthSnapshots();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error running device health snapshot cron:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Snapshot failed' },
      { status: 500 }
    );
  }
}
