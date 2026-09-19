import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * Cached singleton instance of the server-side Supabase client.
 */
let cachedClient: SupabaseClient<Database> | null = null;

/**
 * Checks whether the required Supabase environment variables are present.
 * Safe to call in any context without throwing.
 */
export function isDatabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(url && key && url.trim().length > 0 && key.trim().length > 0);
}

/**
 * Returns a server-side Supabase client initialized with the service role key.
 *
 * SECURITY INVARIANTS:
 * 1. This function strictly guards against browser execution.
 * 2. It requires SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS on the server
 *    and must never be leaked to client bundles.
 */
export function getServiceSupabaseClient(): SupabaseClient<Database> {
  if (typeof window !== "undefined") {
    throw new Error(
      "[PreSend Security] Database access must remain strictly server-side. SUPABASE_SERVICE_ROLE_KEY must never be accessed in the browser."
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "[PreSend DB] Supabase is not configured. Please set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your server environment."
    );
  }

  if (!cachedClient) {
    cachedClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return cachedClient;
}

/**
 * Reset client cache (useful for testing environments).
 */
export function resetClientCache(): void {
  cachedClient = null;
}
