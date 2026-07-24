/**
 * Unread Notifications Count API
 * GET - Get the count of unread notifications for badge display
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { parseAccessToken } from '@/lib/auth-utils';

/**
 * GET /api/notifications/unread-count
 * Get unread notification count for the current user
 */
export async function GET(request: NextRequest) {
  try {
    const user = await parseAccessToken(request.headers.get('Authorization'));
    if (!user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // In-app notifications are backed by a Supabase-only table with no
    // SQLite equivalent; self-hosted installs just show no unread badge.
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ unread_count: 0 });
    }

    const supabase = createServerClient();

    const { count, error } = await supabase
      .from('user_notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.userId)
      .is('read_at', null);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch unread count' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      unread_count: count || 0,
    });
  } catch (error) {
    console.error('[GET /api/notifications/unread-count] Unhandled error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
