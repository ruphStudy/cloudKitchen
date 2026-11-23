import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { serverEnv } from "@/lib/env";

/** Supabase client bound to the visitor's auth cookies (anon key + their session). */
export async function getAuthClient() {
  const store = await cookies();
  return createServerClient(serverEnv.supabaseUrl, serverEnv.supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there. Middleware refreshes them.
        }
      },
    },
  });
}
