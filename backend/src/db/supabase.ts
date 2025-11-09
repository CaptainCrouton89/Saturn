import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../types/database.types';

// Singleton Supabase client
class SupabaseService {
  private static instance: SupabaseService;
  private client: SupabaseClient<Database> | null = null;

  private constructor() {}

  static getInstance(): SupabaseService {
    if (!SupabaseService.instance) {
      SupabaseService.instance = new SupabaseService();
    }
    return SupabaseService.instance;
  }

  getClient(): SupabaseClient<Database> {
    if (!this.client) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !supabaseServiceRoleKey) {
        throw new Error('Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      }

      this.client = createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });
    }

    return this.client;
  }
}

export const supabaseService = SupabaseService.getInstance();
