/**
 * Track Sign-in API Route
 *
 * Called after successful Microsoft authentication to log sign-in events.
 * This provides visibility into authentication activity in Vercel logs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logPermissions } from '@/lib/permission-logger';
import { parseAccessToken } from '@/lib/auth-utils';

interface SignInTrackingPayload {
  authMethod: 'popup' | 'redirect' | 'silent';
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // This writes an authoritative entry to the permission-audit log, so the
    // identity fields must come from a verified access token - not the
    // request body, which any anonymous caller could otherwise fill in with
    // an arbitrary userId/tenantId/email to poison the audit trail.
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const payload: SignInTrackingPayload = await request.json();
    const { authMethod } = payload;

    // Log the sign-in event
    logPermissions({
      route: '/api/auth/track-signin',
      action: 'user_signed_in',
      tenantId: user.tenantId,
      granted: true,
      details: {
        userId: user.userId,
        email: user.userEmail,
        name: user.userName,
        authMethod,
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
