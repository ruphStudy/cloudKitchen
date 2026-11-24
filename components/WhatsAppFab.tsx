"use client";

import { usePathname } from "next/navigation";
import { KITCHEN, WHATSAPP_NUMBER } from "@/lib/config";
import { waLink } from "@/lib/whatsapp";

/** Floating "Help on WhatsApp" button for customer pages (hidden in admin). */
export function WhatsAppFab() {
  const path = usePathname();
  if (!WHATSAPP_NUMBER || path.startsWith("/admin")) return null;

  return (
    <a
      href={waLink(WHATSAPP_NUMBER, KITCHEN.helpMessage)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Help on WhatsApp"
      className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-13 w-13 items-center justify-center rounded-full bg-[#1fa855] text-white shadow-lg active:scale-95 min-[480px]:right-[calc(50%-14rem+1rem)]"
    >
      <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden>
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm5.8 14.04c-.24.68-1.4 1.3-1.94 1.38-.5.07-1.13.1-1.82-.11-.42-.13-.96-.31-1.65-.61-2.9-1.25-4.79-4.17-4.94-4.36-.14-.19-1.18-1.57-1.18-3s.75-2.13 1.02-2.42c.27-.29.58-.36.78-.36h.56c.18 0 .42-.07.66.5.24.58.82 2.01.89 2.16.07.14.12.31.02.5-.1.19-.14.31-.29.48-.14.17-.3.37-.43.5-.14.14-.29.3-.13.59.17.29.74 1.22 1.59 1.98 1.09.97 2.01 1.27 2.3 1.42.29.14.46.12.63-.07.17-.19.72-.84.91-1.13.19-.29.39-.24.65-.14.27.1 1.69.8 1.98.94.29.14.48.22.55.34.07.12.07.7-.17 1.38z" />
      </svg>
    </a>
  );
}
