import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesModel, normalizeModelId } from "../bin/scheduler.mjs";

test("normalizeModelId lowercases and strips whitespace", () => {
  assert.equal(normalizeModelId("DeepSeek-V4-Flash"), "deepseek-v4-flash");
  assert.equal(normalizeModelId("  abc def "), "abcdef");
});

test("matchesModel accepts the wildcard", () => {
  assert.equal(matchesModel({ activeForModels: ["*"] }, "anything"), true);
});

test("matchesModel compares normalized ids", () => {
  const shadow = { activeForModels: ["deepseek-v4-flash"] };
  assert.equal(matchesModel(shadow, "DeepSeek-V4-Flash"), true);
  assert.equal(matchesModel(shadow, "claude-sonnet-5"), false);
});