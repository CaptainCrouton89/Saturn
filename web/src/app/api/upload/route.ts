/**
 * Next.js API Route: Upload information dump (Admin Tool)
 *
 * Proxies requests to backend /api/information-dumps endpoint.
 * Uses admin key for authentication.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, label, content, source_type, user_id } = body;

    // Validate required fields
    if (!user_id) {
      return NextResponse.json(
        { error: 'user_id is required' },
        { status: 400 }
      );
    }

    // Get config
    const backendUrl = process.env.NEXT_PUBLIC_API_URL;
    const adminKey = process.env.NEXT_PUBLIC_ADMIN_KEY;

    if (!backendUrl) {
      throw new Error('NEXT_PUBLIC_API_URL environment variable is not set');
    }

    if (!adminKey) {
      throw new Error('NEXT_PUBLIC_ADMIN_KEY environment variable is not set');
    }

    // Forward to backend with admin authentication
    const backendResponse = await fetch(`${backendUrl}/api/information-dumps`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': adminKey
      },
      body: JSON.stringify({
        title,
        label,
        content,
        source_type,
        user_id
      })
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
