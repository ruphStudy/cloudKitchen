/**
 * Public site URL used for OG tags, sitemap, magic links and feedback links.
 * NEXT_PUBLIC_SITE_URL (your custom domain) wins; on Vercel we fall back to the
 * production domain Vercel provides; locally, localhost.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}
