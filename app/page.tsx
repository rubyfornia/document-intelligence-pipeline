import Library from "@/components/Library";
import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl p-6 sm:p-10">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Document Intelligence Pipeline</h1>
          <p className="mt-1 text-gray-600">PDF → structured representation, with the routing decisions on display.</p>
        </div>
        <Link href="/relations" className="text-brand-700 hover:underline">Relationships →</Link>
      </header>
      <Library />
    </main>
  );
}
