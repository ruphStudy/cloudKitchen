import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getAuthClient } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

/**
 * Magic-link landing. Supports both:
 * - ?token_hash=…&type=email  (recommended email template; works when the link opens in another browser/app)
 * - ?code=…                   (default PKCE link; must open in the same browser that requested it)
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = searchParams.get("next");
  const safeNext = next && next.startsWith("/admin") ? next : "/admin";
  const supabase = await getAuthClient();

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");

  let ok = false;
  if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }

  return NextResponse.redirect(new URL(ok ? safeNext : "/admin/login?error=link", origin));
}
