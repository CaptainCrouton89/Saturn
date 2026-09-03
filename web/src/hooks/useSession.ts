'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export interface Session {
  /** Supabase access token; the backend derives the subject user from it. */
  token: string;
  userId: string;
}

/**
 * The signed-in Supabase session, or null while it is still being read.
 * Redirects to /login when there is no session, so a page that renders on a
 * non-null value never has to handle the signed-out case.
 */
export function useSession(): Session | null {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        window.location.href = '/login';
        return;
      }
      setSession({ token: session.access_token, userId: session.user.id });
    });
  }, []);

  return session;
}
