import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/server";
import { FeedbackForm, FeedbackThanks } from "@/components/FeedbackForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "How was it?", robots: { index: false, follow: false } };

interface OrderForFeedback {
  id: string;
  order_no: string;
  status: string;
  customer_name: string;
  order_items: { name: string; quantity: number }[];
  feedback: { id: string }[] | { id: string } | null;
}

export default async function FeedbackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!z.uuid().safeParse(token).success) notFound();

  const { data: order, error } = await getAdminClient()
    .from("orders")
    .select("id,order_no,status,customer_name,order_items(name,quantity),feedback(id)")
    .eq("public_token", token)
    .maybeSingle<OrderForFeedback>();
  if (error) throw new Error(error.message);
  if (!order || !["paid", "ready", "picked_up"].includes(order.status)) notFound();

  const alreadyGiven = Array.isArray(order.feedback) ? order.feedback.length > 0 : !!order.feedback;
  const dishes = order.order_items.map((i) => (i.quantity > 1 ? `${i.quantity} × ${i.name}` : i.name)).join(", ");

  return (
    <main className="px-4 pb-28 pt-8">
      <p className="text-sm text-stone-500">Order {order.order_no}</p>
      <h1 className="mt-1 text-2xl font-bold leading-tight">{dishes}</h1>
      {alreadyGiven ? (
        <FeedbackThanks already />
      ) : (
        <>
          <p className="mt-1 text-stone-600">Hi {order.customer_name}, how was it? This takes 20 seconds.</p>
          <FeedbackForm token={token} />
        </>
      )}
      <div className="mt-8 text-center">
        <Link href="/" className="font-semibold text-brand-600">
          Back to menu
        </Link>
      </div>
    </main>
  );
}
