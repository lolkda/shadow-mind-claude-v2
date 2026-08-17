// Admin CLI (v2): status | pause | resume | now [id] | list | create | delete | config get|set | sync-agents
// Usage: node bin/admin.mjs <command> [args...]

import { writeFile, unlink, readFile, mkdir, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { configPath, shadowDir, agentDir } from "./paths.mjs";
import { ConfigStore, validateConfig } from "./config.mjs";
import { ShadowRegistry, parseShadowMarkdown } from "./registry.mjs";
import { diffManifest } from "./manifest.mjs";
import { syncAgents } from "./sync-agents.mjs";
// Single source of sync parameters: create/delete and sync-agents all read the
// live config instead of drifting to per-call defaults.
async function syncWithConfig() {
  await configStore.initialize();
  const { config, error } = await configStore.reload();
  const result = await syncAgents(process.cwd(), {
    effort: config.default_thinking_level,
    budgetSeconds: config.default_shadow_timeout_seconds,
    defaultModel: config.default_shadow_model,
  });
  const parts = [`synced ${result.written.length} subagent definition(s) to .claude/agents/`];
  if (result.diagnostics.length) parts.push(result.diagnostics.map((d) => `! ${d.filePath}: ${d.message}`).join("\n"));
  if (error) parts.push(`config error: ${error}`);
  return parts.join("\n");
}


const registry = new ShadowRegistry();
const configStore = new ConfigStore();
const pausedPath = join(agentDir, ".paused");

async function readDrift() {
  let raw;
  try {
    raw = await readFile(join(agentDir, ".installed-manifest.json"), "utf8");
  } catch {
    return ["install: no manifest (old install; rerun install.mjs)"];
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    return [`install: manifest unreadable (${error instanceof Error ? error.message : String(error)})`];
  }
  const lines = [];
  try {
    const repoDiff = await diffManifest(manifest.repoFiles, manifest.repoDir);
    if (repoDiff.length) {
      lines.push(`✗ repo changed since install: ${repoDiff.length} file(s) differ (rerun install.mjs)`);
      lines.push(...repoDiff.slice(0, 8).map((d) => `  ${d.path} (${d.state})`));
      if (repoDiff.length > 8) lines.push(`  … and ${repoDiff.length - 8} more`);
    }
  } catch {
    lines.push("✗ repo dir unreachable");
  }
  try {
    const copyDiff = await diffManifest(manifest.copyFiles, manifest.copyDir);
    if (copyDiff.length) {
      lines.push(`✗ installed copy drifted: ${copyDiff.length} file(s) differ`);
      lines.push(...copyDiff.slice(0, 8).map((d) => `  ${d.path} (${d.state})`));
    }
  } catch {
    lines.push("✗ installed copy unreachable");
  }
  return lines.length ? lines : ["install: in sync"];
}

async function templateDrift() {
  // Live config lives in ~/.claude/shadow-minds/config.json; the repo template
  // is only copied at install time. Surface divergence so "changed but not
  // effective" never stays silent.
  try {
    const marker = JSON.parse(await readFile(join(homedir(), ".claude", "shadow-mind.json"), "utf8"));
    const template = JSON.parse(await readFile(join(marker.pluginDir, "shadow-minds", "config.json"), "utf8"));
    const live = JSON.parse(await readFile(configPath, "utf8"));
    const keys = Object.keys(template).filter((k) => template[k] !== undefined);
    const diffs = keys.filter((k) => JSON.stringify(template[k]) !== JSON.stringify(live[k]));
    if (diffs.length) return `○ config template differs from live: ${diffs.join(", ")} (repo shadow-minds/config.json)`;
    return null;
  } catch {
    return null;
  }
}

async function cmdStatus() {
  await configStore.initialize();
  await registry.initialize();
  const { config, error } = await configStore.reload();
  const snapshot = await registry.load();
  let paused = false;
  try {
    await readFile(pausedPath);
    paused = true;
  } catch {
    // not paused
  }
  const templateDriftLine = await templateDrift();
  const configLines = [
    "Shadow Mind v2 status",
    `config: ${error ?? "ok"}`,
    `timeout ${config.default_shadow_timeout_seconds}s · effort ${config.default_thinking_level}`,
    `auto review: ${config.auto_review_enabled ? `on (${config.auto_review_exts.join(", ")})` : "off"}`,
    ...(templateDriftLine ? [templateDriftLine] : []),
    `definitions: ${snapshot.shadows.length} valid · ${snapshot.diagnostics.length} invalid`,
    ...snapshot.diagnostics.map((d) => `  ! ${d.filePath}: ${d.message}`),
  ];
  const driftLines = await readDrift();
  return [
    `🐙 Shadow Mind v2 · ${paused ? "paused" : "active"}`,
    ...configLines,
    "",
    ...driftLines,
    "",
    "Commands: /shadow now | pause | resume | status | sync-agents",
    "",
    "Shadows:",
    ...(snapshot.shadows.length
      ? snapshot.shadows.map((s) => `  ${s.enabled ? "enabled" : "disabled"} ${s.id} (${s.name}) models=${s.activeForModels.join(",")} tools=${s.tools.join(",") || "default"} file=${s.filePath}`)
      : ["  (none)"]),
  ].join("\n");
}

async function cmdConfig(action) {
  await configStore.initialize();
  if (action === "get") {
    const { config, error } = await configStore.reload();
    return `${error ? `config error: ${error}\n` : ""}${JSON.stringify(config, null, 2)}`;
  }
  if (action !== "set") throw new Error("usage: config get | set <key> <value>");
  const [key, rawValue] = process.argv.slice(4);
  if (!key || rawValue === undefined) throw new Error("usage: config set <key> <value>");
  let value;
  try {
    value = JSON.parse(rawValue);
  } catch {
    value = rawValue;
  }
  const validated = validateConfig({ ...configStore.current, [key]: value });
  await configStore.write(validated);
  return `config updated: ${key} = ${JSON.stringify(value)}`;
}

async function cmdShadow(action, id, extra) {
  await registry.initialize();
  const snapshot = await registry.load();
  if (action === "list") {
    return snapshot.diagnostics.length
      ? `${snapshot.diagnostics.map((d) => `! ${d.filePath}: ${d.message}`).join("\n")}\n`
      : snapshot.shadows.length
        ? snapshot.shadows.map((s) => `${s.enabled ? "enabled" : "disabled"} ${s.id} (${s.name}) models=${s.activeForModels.join(",")} tools=${s.tools.join(",") || "default"} file=${s.filePath}`).join("\n")
        : "(no shadow definitions)";
  }
  if (action === "create") {
    if (!id) throw new Error("usage: create <id> [name] [prompt-file]");
    const filePath = join(shadowDir, `${id}.md`);
    const name = extra ?? id;
    const prompt = "Describe this Shadow Mind's responsibility.";
    const source = registry.serialize({ id, name, enabled: true, debug: false, activeForModels: ["*"], runWithModel: undefined, thinkingLevel: undefined, timeoutSeconds: undefined, tools: [], prompt });
    if (snapshot.shadows.some((s) => s.id === id)) throw new Error(`shadow already exists: ${id}`);
    await writeFile(filePath, source, { encoding: "utf8", flag: "wx" });
    await syncWithConfig();
    return `Created ${id} at ${filePath}; subagent definition synced.\nEdit the body to describe its responsibility.`;
  }
  if (action === "delete") {
    if (!id) throw new Error("usage: delete <id>");
    const target = snapshot.shadows.find((s) => s.id === id);
    if (!target) throw new Error(`shadow not found: ${id}`);
    await unlink(target.filePath);
    await syncWithConfig();
    return `Deleted ${id}; subagent definitions re-synced.`;
  }
  throw new Error(`unknown shadow action: ${action}`);
}

async function cmdSyncAgents() {
  return syncWithConfig();
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  let output;
  switch (command) {
    case "status":
      output = await cmdStatus();
      break;
    case "list":
      output = await cmdShadow("list");
      break;
    case "create":
      output = await cmdShadow("create", rest[0], rest[1]);
      break;
    case "delete":
      output = await cmdShadow("delete", rest[0]);
      break;
    case "config":
      output = await cmdConfig(rest[0]);
      break;
    case "sync-agents":
      output = await cmdSyncAgents();
      break;
    case "pause": {
      await mkdir(agentDir, { recursive: true });
      await writeFile(pausedPath, `${new Date().toISOString()}\n`, "utf8");
      output = "Shadow Mind paused (triggers suppressed until /shadow resume).";
      break;
    }
    case "resume": {
      await rm(pausedPath, { force: true });
      output = "Shadow Mind resumed.";
      break;
    }
    case "now": {
      const targetId = rest[0] ?? "*";
      const snapshot = await registry.load();
      if (targetId !== "*" && !snapshot.shadows.some((s) => s.id === targetId)) {
        throw new Error(`shadow not found: ${targetId}`);
      }
      await rm(join(agentDir, ".force-trigger.json"), { force: true });
      await writeFile(join(agentDir, ".force-trigger.json"), `${JSON.stringify({ id: targetId, at: Date.now() }, null, 2)}\n`, "utf8");
      output = `Force trigger armed: this turn's Stop hook will inject an activation instruction for ${targetId === "*" ? "all enabled shadows" : targetId}. Reports arrive as completion notifications - no user input needed.`;
      break;
    }
    default:
      throw new Error("usage: status | pause | resume | now [id] | list | create | delete | config get|set | sync-agents");
  }
  process.stdout.write(`${output}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`[shadow-mind] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
