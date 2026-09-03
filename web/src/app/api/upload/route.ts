/**
 * Next.js API Route: Upload information dump
 *
 * Proxies requests to backend /api/information-dumps endpoint, forwarding the
 * caller's Supabase access token. The backend derives the owning user from that
 * token, so this route never names a user_id and never uses the admin key.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    // The caller's session is the only authority for who owns this upload
    const supabase = await createClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'You must be logged in to upload' },
        { status: 401 }
      );
    }

    const { content, source_type } = (await request.json()) as {
      content: string;
      source_type: string;
    };

    const backendUrl = process.env.NEXT_PUBLIC_API_URL;
    if (!backendUrl) {
      throw new Error('NEXT_PUBLIC_API_URL environment variable is not set');
    }

    const backendResponse = await fetch(`${backendUrl}/api/information-dumps`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ content, source_type })
    });

    const backendData = await backendResponse.json();

    // Forward backend response
    return NextResponse.json(backendData, {
      status: backendResponse.status
    });

  } catch (error) {
    console.error('Upload API error:', error);

    return NextResponse.json(
      { error: 'Failed to connect to backend service' },
      { status: 500 }
    );
  }
}
