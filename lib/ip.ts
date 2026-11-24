import "server-only";
import crypto from "node:crypto";

/** Client IP from proxy headers (Vercel sets x-forwarded-for; the first entry is the client). */
export function clientIpFrom(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}

/** Short SHA-256 of the IP, so raw IPs are never stored. */
export function ipBucket(prefix: string, headers: Headers): string {
  return `${prefix}:${crypto.createHash("sha256").update(clientIpFrom(headers)).digest("hex").slice(0, 32)}`;
}
