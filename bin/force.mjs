// Force-trigger file protocol: the single implementation shared by the stop
// hook (reader/cleaner) and admin (writer). A one-shot force file carries an
// `at` timestamp; readers fall back to the file mtime for legacy files so the
// TTL still applies to interrupted triggers.

import { readFile, stat, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { agentDir } from "./paths.mjs";

export const FORCE_TTL_MS = 3600_000;

/** True while the trigger is fresh; legacy files without a timestamp are valid. */
export function isValidForce(force, now = Date.now()) {
  return Boolean(force) && (typeof force.at !== "number" || now - force.at <= FORCE_TTL_MS);
}

/**
 * Create a force-trigger store rooted at a directory (defaults to the real
 * agent dir; tests inject a temp dir).
 */
export function createForceStore(dir = agentDir) {
  const path = join(dir, ".force-trigger.json");
  return {
    path,
    /** Arm a one-shot manual trigger (admin "/shadow now [id]"). */
    async write(id = "*") {
      // Truncating write removes the rm→write race of the old implementation.
      // A mid-write failure may leave a broken file, but read() degrades it to
      // null (no trigger) - never a spurious activation.
      await writeFile(path, `${JSON.stringify({ id, at: Date.now() }, null, 2)}\n`, "utf8");
    },
    /** Read the trigger; null when absent/broken. */
    async read() {
      try {
        const raw = await readFile(path, "utf8");
        const parsed = JSON.parse(raw);
        if (typeof parsed.at === "number") return parsed;
        try {
          const stats = await stat(path);
          if (stats.mtimeMs > 0) return { ...parsed, at: stats.mtimeMs };
        } catch {
          // stat raced a deletion; fall through to legacy behaviour.
        }
        return parsed;
      } catch {
        return null;
      }
    },
    /** Consume the trigger; real failures are reported through the log fn. */
    async clear(log) {
      try {
        await unlink(path);
      } catch (error) {
        if (log && !(error && error.code === "ENOENT")) {
          log(`clearForce failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
  };
}

/** Default store bound to the real agent dir (kept private; aliases below). */
const defaultStore = createForceStore();

export const forcePath = defaultStore.path;
export const readForce = defaultStore.read;
export const writeForce = defaultStore.write;
export const clearForce = defaultStore.clear;