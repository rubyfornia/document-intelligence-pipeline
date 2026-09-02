export const dynamic = "force-dynamic";

export default function SignIn({ searchParams }: { searchParams: { next?: string; error?: string } }) {
  const next = searchParams.next && searchParams.next.startsWith("/") && !searchParams.next.startsWith("//") ? searchParams.next : "/";
  return (
    <main className="mx-auto max-w-md p-6 sm:p-10">
      <h1 className="text-2xl font-bold text-gray-900">Document Intelligence Pipeline</h1>
      <p className="mt-1 text-gray-600">This instance is shared by passcode. Enter it to continue; a session lasts three hours.</p>
      <form method="post" action="/api/auth" className="mt-6 space-y-3 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <input type="hidden" name="next" value={next} />
        <label className="block text-sm font-medium text-gray-700">
          Passcode
          <input name="passcode" type="password" autoFocus autoComplete="off" required
                 className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-gray-900 focus:border-brand-400 focus:outline-none" />
        </label>
        {searchParams.error && <div className="rounded bg-rose-50 px-3 py-2 text-sm text-rose-800">That passcode didn't match.</div>}
        <button type="submit" className="w-full rounded bg-brand-600 px-3 py-2 font-medium text-white hover:bg-brand-700">Enter</button>
      </form>
    </main>
  );
}
