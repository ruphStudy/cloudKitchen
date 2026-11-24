import type { Instrumentation } from "next";

/**
 * Logs every uncaught server error (pages, route handlers, server actions) as one
 * JSON line, so it is easy to search in Vercel → Logs. To use Sentry instead, see the README.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err as Error & { digest?: string };
  console.error(
    JSON.stringify({
      level: "error",
      msg: e.message,
      digest: e.digest,
      stack: e.stack?.split("\n").slice(0, 8).join("\n"),
      method: request.method,
      path: request.path, // no query string: may contain tokens
      routePath: context.routePath,
      routeType: context.routeType,
    }),
  );
};
