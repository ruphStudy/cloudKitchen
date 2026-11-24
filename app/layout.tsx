import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CartProvider } from "@/components/CartProvider";
import { WhatsAppFab } from "@/components/WhatsAppFab";
import { KITCHEN } from "@/lib/config";
import { siteUrl } from "@/lib/site";

const title = `${KITCHEN.name} · Weekend pre-orders in Pune`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: title, template: `%s · ${KITCHEN.name}` },
  description: KITCHEN.tagline,
  applicationName: KITCHEN.name,
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: "/",
    siteName: KITCHEN.name,
    title,
    description: KITCHEN.tagline,
    // Image comes from app/opengraph-image.tsx
  },
  twitter: { card: "summary_large_image", title, description: KITCHEN.tagline },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#c2410c",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN">
      <body className="antialiased">
        <CartProvider>
          <div className="mx-auto min-h-dvh max-w-md">{children}</div>
          <WhatsAppFab />
        </CartProvider>
      </body>
    </html>
  );
}
