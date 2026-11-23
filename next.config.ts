import type { NextConfig } from "next";

// Allow dish photos from Supabase Storage.
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  images: {
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/public/**" }]
      : [],
  },
  experimental: {
    // Dish photo uploads go through a Server Action (resized in the browser first).
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
