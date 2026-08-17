// Generate .claude/agents/shadow-<id>.md subagent definitions from the
// shadow-minds registry. Shadows are read-only reviewers: tools whitelist,
// Bash/Edit/Write disallowed, maxTurns cap, effort/model mapped.

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ShadowRegistry } from "./registry.mjs";
import { SHADOW_PROTOCOL, timeBudgetLine } from "./protocol.mjs";

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

function frontmatter(meta, body) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    if (typeof value === "string") lines.push(`${key}: ${JSON.stringify(value)}`);
    else if (Array.isArray(value)) lines.push(`${key}: [${value.map((v) => JSON.stringify(v)).join(", ")}]`);
    else lines.push(`${key}: ${String(value)}`);
  }
  lines.push("---", "", body ?? "");
  return `${lines.join("\n")}\n`;
}

/**
 * @param {string} cwd project directory for .claude/agents
 * @param {{ effort?: string, budgetSeconds?: number, defaultModel?: string | null }} [options]
 * @returns {Promise<{ written: string[], skipped: string[], diagnostics: { filePath: string, message: string }[] }>}
 */
export async function syncAgents(cwd = process.cwd(), { effort = "medium", budgetSeconds = 300, defaultModel = null } = {}) {
  const registry = new ShadowRegistry();
  await registry.initialize();
  const { shadows, diagnostics } = await registry.load();
  const agentsDir = join(cwd, ".claude", "agents");
  await mkdir(agentsDir, { recursive: true });
  const written = [];
  const skipped = [];
  for (const shadow of shadows) {
    const level = shadow.thinkingLevel && THINKING_LEVELS.has(shadow.thinkingLevel) ? shadow.thinkingLevel : effort;
    const model = shadow.runWithModel ?? defaultModel;
    const meta = {
      name: `shadow-${shadow.id}`,
      description: `Shadow Mind "${shadow.id}" 的只读后台审阅进程；由 /shadow 激活指令点名启动。`,
      tools: ["Read", "Grep", "Glob", "LS"],
      disallowedTools: ["Bash", "Edit", "Write"],
      maxTurns: 5,
      effort: level,
      ...(model ? { model } : {}),
    };
    const body = `${shadow.prompt}\n\n${SHADOW_PROTOCOL}\n\n${timeBudgetLine(budgetSeconds)}`;
    await writeFile(join(agentsDir, `shadow-${shadow.id}.md`), frontmatter(meta, body), "utf8");
    written.push(shadow.id);
  }
  return { written, skipped, diagnostics };
}
