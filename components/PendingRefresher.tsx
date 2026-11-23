"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const INTERVAL_MS = 3000;
const MAX_TRIES = 20; // ~1 minute

/** Re-fetches the server page while payment confirmation is pending. */
export function PendingRefresher() {
  const router = useRouter();
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (tries >= MAX_TRIES) return;
    const t = setTimeout(() => {
      router.refresh();
      setTries((n) => n + 1);
    }, INTERVAL_MS);
    return () => clearTimeout(t);
  }, [tries, router]);

  if (tries < MAX_TRIES) return null;
  return (
    <p className="mx-auto mt-4 max-w-xs rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
      This is taking longer than usual. If money was deducted, your order will be confirmed automatically — please
      refresh in a minute, or contact us on WhatsApp.
    </p>
  );
}
