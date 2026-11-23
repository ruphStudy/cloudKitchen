"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { isAdminEmail } from "@/lib/admin";
import { getAuthClient } from "@/lib/supabase/auth";

export interface LoginState {
  status: "idle" | "sent" | "error";
  message?: string;
}

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = z.email().safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { status: "error", message: "Please enter a valid email." };
  const email = parsed.data;

  // Only admins get a link, but the response is the same either way (no leaking who is an admin).
  if (await isAdminEmail(email)) {
    const h = await headers();
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? h.get("origin") ?? `https://${h.get("host")}`;
    const supabase = await getAuthClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${origin}/auth/confirm?next=/admin`, shouldCreateUser: true },
    });
    if (error) {
      console.error("signInWithOtp failed", error);
      return {
        status: "error",
        message: error.status === 429 ? "Too many emails. Please wait a minute." : "Could not send the link. Try again.",
      };
    }
  }

  return { status: "sent", message: `If ${email} is an admin, a login link is on its way. Check your inbox.` };
}
