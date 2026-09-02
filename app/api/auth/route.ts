import { NextResponse } from "next/server";
import { COOKIE, SESSION_MS, issueToken, safeEqual } from "@/lib/auth";
export const dynamic = "force-dynamic";

const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/" };

// POST: exchange the shared passcode for a signed, expiring session cookie. A wrong guess waits
// half a second — enough to make brute force tedious, not enough to make a typo painful.
export async function POST(req: Request) {
  const secret = process.env.SITE_PASSCODE;
  if (!secret) return NextResponse.json({ error: "SITE_PASSCODE is not configured" }, { status: 503 });
  const json = (req.headers.get("content-type") ?? "").includes("application/json");
  let passcode = "", next = "/";
  if (json) {
    const j = await req.json().catch(() => ({}));
    passcode = String(j.passcode ?? ""); next = String(j.next ?? "/");
  } else {
    const f = await req.formData();
    passcode = String(f.get("passcode") ?? ""); next = String(f.get("next") ?? "/");
  }
  if (!next.startsWith("/") || next.startsWith("//")) next = "/"; // never redirect off-site

  if (!safeEqual(passcode.trim(), secret)) {
    await new Promise(r => setTimeout(r, 500));
    if (json) return NextResponse.json({ error: "wrong passcode" }, { status: 401 });
    return NextResponse.redirect(new URL(`/signin?error=1&next=${encodeURIComponent(next)}`, req.url), 303);
  }

  const token = await issueToken(secret);
  const res = json
    ? NextResponse.json({ ok: true, expires_in_s: SESSION_MS / 1000 })
    : NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.set(COOKIE, token, { ...cookieOpts, maxAge: SESSION_MS / 1000 });
  return res;
}

// DELETE: sign out — the cookie is cleared; nothing else was ever stored.
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { ...cookieOpts, maxAge: 0 });
  return res;
}
