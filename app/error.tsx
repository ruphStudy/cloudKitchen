"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Server errors are logged by instrumentation.ts; this records client-side ones in the browser console.
    console.error(error);
  }, [error]);

  return (
    <main className="px-4 pt-20 text-center">
      <p className="text-6xl">😕</p>
      <h1 className="mt-4 text-2xl font-bold">Something went wrong</h1>
      <p className="mt-2 text-stone-600">Please try again. If you already paid, your order is safe.</p>
      {error.digest && <p className="mt-1 text-xs text-stone-400">Error code: {error.digest}</p>}
      <div className="mt-6 flex justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="h-12 rounded-xl bg-brand-600 px-6 text-base font-bold text-white"
        >
          Try again
        </button>
        <Link href="/" className="flex h-12 items-center rounded-xl px-4 font-semibold text-brand-600">
          Menu
        </Link>
      </div>
    </main>
  );
}
