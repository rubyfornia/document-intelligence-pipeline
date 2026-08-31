import Architecture from "@/components/Architecture";
import Link from "next/link";

export default function Page() {
  return (
    <main className="mx-auto max-w-6xl p-6 sm:p-8">
      <header className="mb-6">
        <div className="flex items-center gap-4 text-sm">
          <Link href="/" className="text-brand-700 hover:underline">← Library</Link>
          <Link href="/relations" className="text-brand-700 hover:underline">Relationships →</Link>
        </div>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Architecture</h1>
        <p className="mt-1 text-gray-600">
          The ten-step pipeline, drawn. Every node carries the exact stage name its ledger rows use, so this
          board and any document's ledger read into each other. Hover for the gist; click to pin the details.
        </p>
      </header>
      <Architecture />
    </main>
  );
}
