import { test } from "node:test";
import assert from "node:assert";
import { isTransientModelError } from "../../.test-build/models.js";

test("quota and rate-limit errors are transient", () => {
  assert.ok(isTransientModelError('embed 429: {"error":{"code":429,"message":"Quota exceeded for aiplatform.googleapis.com/global_embed_content_requests_per_minute_per_base_model"}}'));
  assert.ok(isTransientModelError("529 overloaded_error"));
  assert.ok(isTransientModelError("Too Many Requests"));
  assert.ok(isTransientModelError("fetch failed"));
  assert.ok(isTransientModelError("read ECONNRESET"));
});

test("real defects are not transient", () => {
  assert.ok(!isTransientModelError("no recoverable page tree"));
  assert.ok(!isTransientModelError("schema validation failed: blocks[0].bbox.x is required"));
  assert.ok(!isTransientModelError("embed 400: invalid output dimensionality"));
  assert.ok(!isTransientModelError("unknown stage embed2"));
  assert.ok(!isTransientModelError("document id 4290 not found"));
});
