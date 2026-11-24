import type { Metadata } from "next";
import { FeedbackLookup } from "@/components/FeedbackLookup";

export const metadata: Metadata = {
  title: "Feedback",
  description: "Tell us how your bowl was.",
};

/** Landing page for the QR code printed on bowls. */
export default function FeedbackLookupPage() {
  return (
    <main className="px-4 pb-28 pt-10">
      <h1 className="text-2xl font-bold">How was your bowl?</h1>
      <p className="mt-1 text-stone-600">Enter the order number from your bowl and your mobile number.</p>
      <FeedbackLookup />
    </main>
  );
}
