import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

const options = { auth: { persistSession: false, autoRefreshToken: false } };

let publicClient: SupabaseClient | undefined;
let adminClient: SupabaseClient | undefined;

/** Anon client: subject to RLS, can only read the public catalogue. */
export function getPublicClient(): SupabaseClient {
  publicClient ??= createClient(serverEnv.supabaseUrl, serverEnv.supabaseAnonKey, options);
  return publicClient;
}

/** Service-role client: bypasses RLS. Server routes only. */
export function getAdminClient(): SupabaseClient {
  adminClient ??= createClient(serverEnv.supabaseUrl, serverEnv.supabaseServiceRoleKey, options);
  return adminClient;
}
