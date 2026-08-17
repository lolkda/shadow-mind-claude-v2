import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, validateConfig } from "../bin/config.mjs";

test("defaults when empty", () => {
  const config = validateConfig({});
  assert.equal(config.default_thinking_level, "max");
  assert.equal(config.default_shadow_timeout_seconds, 300);
  assert.equal(config.max_trajectory_chars, null);
  assert.equal(config.auto_review_enabled, false);
  assert.ok(Array.isArray(config.auto_review_exts));
  assert.ok(config.auto_review_exts.includes("py"));
  assert.ok(config.auto_review_exts.includes("java"));
});

test("accepts full valid config", () => {
  const config = validateConfig({
    default_shadow_timeout_seconds: 120,
    default_shadow_model: "deepseek-v4-flash",
    default_thinking_level: "low",
    max_trajectory_chars: 100000,
    auto_review_enabled: true,
    auto_review_exts: [".Py", "ts"],
  });
  assert.equal(config.default_shadow_timeout_seconds, 120);
  assert.equal(config.default_thinking_level, "low");
  assert.equal(config.auto_review_enabled, true);
  assert.deepEqual(config.auto_review_exts, ["py", "ts"]);
});

test("rejects negative timeout", () => {
  assert.throws(() => validateConfig({ default_shadow_timeout_seconds: 0 }), /positive/);
});

test("rejects bad thinking level", () => {
  assert.throws(() => validateConfig({ default_thinking_level: "ultra" }), /invalid/);
});

test("rejects non-array or invalid extensions", () => {
  assert.throws(() => validateConfig({ auto_review_exts: "py" }), /array of extension/);
  assert.throws(() => validateConfig({ auto_review_exts: ["py!"] }), /array of extension/);
});

test("DEFAULT_CONFIG validates cleanly", () => {
  assert.doesNotThrow(() => validateConfig(DEFAULT_CONFIG));
});
