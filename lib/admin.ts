import "server-only";
import { cache } from "react";
import { getAdminClient } from "@/lib/supabase/server";
import { getAuthClient } from "@/lib/supabase/auth";

export function envAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * True if the email is in ADMIN_EMAILS or the admins table.
 * Env admins are copied into the table so RLS (Realtime) recognises them too.
 */
export async function isAdminEmail(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  const db = getAdminClient();

  if (envAdminEmails().includes(normalized)) {
    await db.from("admins").upsert({ email: normalized }, { onConflict: "email", ignoreDuplicates: true });
    return true;
  }

  const { data, error } = await db.from("admins").select("email").eq("email", normalized).maybeSingle();
  if (error) throw new Error(`Admin check failed: ${error.message}`);
  return !!data;
}

export type AdminSession =
  | { kind: "admin"; email: string }
  | { kind: "forbidden"; email: string }
  | { kind: "anonymous" };

/** Current visitor's admin status. Memoised per request. */
export const getAdminSession = cache(async (): Promise<AdminSession> => {
  const supabase = await getAuthClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return { kind: "anonymous" };
  return (await isAdminEmail(user.email))
    ? { kind: "admin", email: user.email }
    : { kind: "forbidden", email: user.email };
});

export class NotAdminError extends Error {
  constructor() {
    super("Not allowed");
  }
}

/** Call at the top of every admin Server Action. */
export async function requireAdmin(): Promise<string> {
  const session = await getAdminSession();
  if (session.kind !== "admin") throw new NotAdminError();
  return session.email;
}
