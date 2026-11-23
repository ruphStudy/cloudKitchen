import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAdminSession } from "@/lib/admin";
import { signOut } from "@/app/admin/actions";
import { AdminNav } from "@/components/admin/AdminNav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kitchen admin", robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (session.kind === "anonymous") redirect("/admin/login");

  if (session.kind === "forbidden") {
    return (
      <main className="px-4 pt-16 text-center">
        <h1 className="text-2xl font-bold">Not allowed</h1>
        <p className="mt-2 text-stone-600">{session.email} is not an admin of this kitchen.</p>
        <form action={signOut} className="mt-6">
          <button className="h-12 rounded-xl border-2 border-stone-300 px-6 font-semibold">Sign out</button>
        </form>
      </main>
    );
  }

  return (
    <div className="min-h-dvh bg-stone-100">
      <AdminNav signOut={signOut} />
      {children}
    </div>
  );
}
