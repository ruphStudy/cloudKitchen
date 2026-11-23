import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin";
import { LoginForm } from "@/components/admin/LoginForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin login", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const session = await getAdminSession();
  if (session.kind === "admin") redirect("/admin");
  const { error } = await searchParams;

  return (
    <main className="px-4 pt-16">
      <h1 className="text-2xl font-bold">Kitchen admin</h1>
      <p className="mt-1 text-stone-600">We will email you a login link.</p>
      {error === "link" && (
        <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          That link has expired or was already used. Please request a new one.
        </p>
      )}
      <LoginForm />
    </main>
  );
}
