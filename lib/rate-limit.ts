import "server-only";
import { getAdminClient } from "@/lib/supabase/server";

/** True if allowed (and records the hit). Throws on DB errors. */
export async function hitRateLimit(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { data, error } = await getAdminClient().rpc("hit_rate_limit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });
  if (error) throw new Error(`Rate limit check failed: ${error.message}`);
  return data !== false;
}
