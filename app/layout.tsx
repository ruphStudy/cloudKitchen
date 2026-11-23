import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CartProvider } from "@/components/CartProvider";
import { KITCHEN } from "@/lib/config";

export const metadata: Metadata = {
  title: `${KITCHEN.name} · Weekend pre-orders`,
  description: KITCHEN.tagline,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#c2410c",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <CartProvider>
          <div className="mx-auto min-h-dvh max-w-md">{children}</div>
        </CartProvider>
      </body>
    </html>
  );
}
