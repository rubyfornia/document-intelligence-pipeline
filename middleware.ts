import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, safeEqual, verifyToken } from "@/lib/auth";

// The door. A public instance that spends money per upload sits behind a shared passcode: pages
// redirect to /signin, API routes answer 401, and scripts may present the passcode in an
// x-passcode header. Fail-closed: with no SITE_PASSCODE configured, nothing but the sign-in page
// is served — a missing variable can never leave production open by accident.
const OPEN = new Set(["/signin", "/api/auth", "/api/health"]);

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (OPEN.has(pathname)) return NextResponse.next();

  const secret = process.env.SITE_PASSCODE;
  if (!secret) return new NextResponse("SITE_PASSCODE is not configured; this instance stays closed until it is.", { status: 503 });

  const header = req.headers.get("x-passcode");
  const admitted = (header != null && safeEqual(header, secret)) || (await verifyToken(req.cookies.get(COOKIE)?.value, secret));
  if (admitted) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "passcode required" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/signin";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}
