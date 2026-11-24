import Link from "next/link";

export default function NotFound() {
  return (
    <main className="px-4 pt-20 text-center">
      <p className="text-6xl">🥣</p>
      <h1 className="mt-4 text-2xl font-bold">Page not found</h1>
      <p className="mt-2 text-stone-600">This link may be old or mistyped.</p>
      <Link
        href="/"
        className="mt-6 inline-flex h-12 items-center rounded-xl bg-brand-600 px-6 text-base font-bold text-white"
      >
        See the menu
      </Link>
    </main>
  );
}
