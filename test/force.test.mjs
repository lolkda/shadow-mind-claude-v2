import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FORCE_TTL_MS, isValidForce, createForceStore } from "../bin/force.mjs";

test("isValidForce: fresh, expired, legacy and null", () => {
  const now = 1_000_000;
  assert.equal(isValidForce({ id: "*", at: now }, now), true);
  assert.equal(isValidForce({ id: "*", at: now - FORCE_TTL_MS - 1 }, now), false);
  assert.equal(isValidForce({ id: "*" }, now), true); // legacy: no timestamp
  assert.equal(isValidForce(null, now), false);
  assert.equal(isValidForce(undefined, now), false);
});

test("write then read round-trips with timestamp", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shadow-force-"));
  try {
    const store = createForceStore(dir);
    await store.write("code-reviewer");
    const force = await store.read();
    assert.equal(force.id, "code-reviewer");
    assert.equal(typeof force.at, "number");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("read returns null when absent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shadow-force-"));
  try {
    assert.equal(await createForceStore(dir).read(), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("write overwrites a previous trigger", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shadow-force-"));
  try {
    const store = createForceStore(dir);
    await store.write("a");
    await store.write("b");
    const force = await store.read();
    assert.equal(force.id, "b");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("corrupted trigger file degrades to null (never a spurious activation)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shadow-force-"));
  try {
    const store = createForceStore(dir);
    await writeFile(join(dir, ".force-trigger.json"), "{broken json", "utf8");
    assert.equal(await store.read(), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("clear removes the trigger", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shadow-force-"));
  try {
    const store = createForceStore(dir);
    await store.write();
    assert.notEqual(await store.read(), null);
    await store.clear(() => {});
    assert.equal(await store.read(), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("legacy force file without at uses mtime fallback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shadow-force-"));
  try {
    const store = createForceStore(dir);
    await writeFile(join(dir, ".force-trigger.json"), JSON.stringify({ id: "*" }), "utf8");
    const force = await store.read();
    assert.equal(force.id, "*");
    assert.equal(typeof force.at, "number"); // mtime backfill
    assert.equal(isValidForce(force), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("clear failure is reported through the log callback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "shadow-force-"));
  try {
    const logged = [];
    await createForceStore(dir).clear((msg) => logged.push(msg));
    assert.equal(logged.length, 0); // nothing to clear, unlink fails quietly
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});