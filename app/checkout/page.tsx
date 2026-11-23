import type { Metadata } from "next";
import { getCatalog } from "@/lib/catalog";
import { CheckoutForm } from "@/components/CheckoutForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage() {
  const catalog = await getCatalog();
  return <CheckoutForm catalog={catalog} />;
}
