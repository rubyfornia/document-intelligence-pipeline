// Passcode sessions: an HMAC-signed expiry. Web Crypto only, so the same code runs in Edge
// middleware and Node route handlers. The passcode never leaves its environment variable.
export const COOKIE = "dip_session";
export const SESSION_MS = 3 * 60 * 60 * 1000; // 3 hours — checked server-side, so a copied cookie dies on schedule too

const enc = new TextEncoder();

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison: the passcode check must not leak how many characters matched. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** `${expiryMs}.${hmac}` — the only state a session carries is when it ends. */
export async function issueToken(secret: string, now = Date.now()): Promise<string> {
  const exp = String(now + SESSION_MS);
  return `${exp}.${await hmacHex(secret, exp)}`;
}

export async function verifyToken(token: string | undefined, secret: string, now = Date.now()): Promise<boolean> {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) <= now) return false;
  return safeEqual(sig, await hmacHex(secret, exp));
}
