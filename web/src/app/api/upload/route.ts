import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, label, content, user_id } = body;

    // Validate title
    if (!title || typeof title !== 'string') {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      );
    }

    if (title.length < 1 || title.length > 200) {
      return NextResponse.json(
        { error: 'Title must be between 1 and 200 characters' },
        { status: 400 }
      );
    }

    // Validate label (optional)
    if (label !== undefined && label !== null) {
      if (typeof label !== 'string') {
        return NextResponse.json(
          { error: 'Label must be a string' },
          { status: 400 }
        );
      }

      if (label.length > 200) {
        return NextResponse.json(
          { error: 'Label must not exceed 200 characters' },
          { status: 400 }
        );
      }
    }

    // Validate content
    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      );
    }

    if (content.length < 1 || content.length > 50000) {
      return NextResponse.json(
        { error: 'Content must be between 1 and 50,000 characters' },
        { status: 400 }
      );
    }

    // Validate user_id (MVP: required in request body)
    if (!user_id || typeof user_id !== 'string') {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // Get backend URL from environment variable
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!backendUrl) {
      throw new Error('NEXT_PUBLIC_BACKEND_URL environment variable is not set');
    }
    const endpoint = `${backendUrl}/api/information-dumps`;

    // MVP Note: Backend expects JWT authentication, but web doesn't have it yet.
    // For now, we'll forward without proper JWT. This is a known limitation.
    // TODO: Implement proper JWT authentication for web app
    const requestBody = {
      title: title.trim(),
      label: label?.trim() || undefined,
      content: content.trim(),
      // Note: In production, user_id would come from JWT token, not request body
      user_id
    };

    // Forward request to backend
    const backendResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // TODO: Add proper JWT token here when web auth is implemented
        // 'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(requestBody)
    });

    // Parse backend response
    const backendData = await backendResponse.json();

    // Forward backend response status and body
    if (!backendResponse.ok) {
      return NextResponse.json(
        backendData,
        { status: backendResponse.status }
      );
    }

    return NextResponse.json(
      backendData,
      { status: backendResponse.status }
    );

  } catch (error) {
    console.error('API error:', error);

    // Handle fetch errors (backend connection issues)
    if (error instanceof TypeError && error.message.includes('fetch')) {
      return NextResponse.json(
        { error: 'Failed to connect to backend service' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
