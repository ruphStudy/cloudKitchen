"use client";

/** Last-resort error screen (when the root layout itself fails). Must render its own <html>. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-IN">
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "80px 16px", background: "#fafaf9" }}>
        <h1 style={{ fontSize: 24 }}>Something went wrong</h1>
        <p style={{ color: "#57534e" }}>Please try again. If you already paid, your order is safe.</p>
        {error.digest && <p style={{ color: "#a8a29e", fontSize: 12 }}>Error code: {error.digest}</p>}
        <button
          type="button"
          onClick={reset}
          style={{ marginTop: 24, height: 48, padding: "0 24px", borderRadius: 12, border: 0, background: "#c2410c", color: "white", fontSize: 16, fontWeight: 700 }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
