import { test } from "node:test";
import assert from "node:assert";
import { issueToken, verifyToken, safeEqual, SESSION_MS } from "../../.test-build/auth.js";

const SECRET = "test-secret";

test("a fresh token verifies, and carries a three-hour expiry", async () => {
  const now = 1_700_000_000_000;
  const tok = await issueToken(SECRET, now);
  assert.equal(Number(tok.split(".")[0]), now + SESSION_MS);
  assert.equal(await verifyToken(tok, SECRET, now + 1000), true);
});

test("an expired token is refused", async () => {
  const now = 1_700_000_000_000;
  const tok = await issueToken(SECRET, now);
  assert.equal(await verifyToken(tok, SECRET, now + SESSION_MS), false);
  assert.equal(await verifyToken(tok, SECRET, now + SESSION_MS + 1), false);
});

test("a tampered or foreign token is refused", async () => {
  const tok = await issueToken(SECRET);
  const [exp, sig] = tok.split(".");
  assert.equal(await verifyToken(`${Number(exp) + 60_000}.${sig}`, SECRET), false); // expiry edited
  assert.equal(await verifyToken(tok, "other-secret"), false);                     // signed elsewhere
  assert.equal(await verifyToken("garbage", SECRET), false);
  assert.equal(await verifyToken(undefined, SECRET), false);
});

test("safeEqual is exact and length-sensitive", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
});
