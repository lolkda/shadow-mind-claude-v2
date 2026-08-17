// Stop hook (v2): explicit /shadow now force file + auto_review extension
// trigger. On a hit it injects a <shadow-activation> instruction via
// additionalContext; the main agent spawns background shadow subagents whose
// completion notifications wake the main agent automatically. No collector,
// no report queue, no drain.
// Contract: always exit 0; stdout is either an empty string or exactly one JSON object.

import { readFile, stat, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readStdinJson, logDebug } from "./util.mjs";
import { ConfigStore } from "./config.mjs";
import { ShadowRegistry } from "./registry.mjs";
import { matchesModel, normalizeModelId, forceTriggerValid } from "./scheduler.mjs";
import { resolveMainModelId } from "./modelid.mjs";
import { touchMatchingExt } from "./trigger.mjs";
import { timeBudgetLine } from "./protocol.mjs";
import { agentDir } from "./paths.mjs";

const pluginDir = dirname(dirname(fileURLToPath(import.meta.url)));

async function readForceTrigger() {
  const path = join(agentDir, ".force-trigger.json");
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.at === "number") return parsed;
    // Legacy force files without a timestamp fall back to file mtime so the
    // TTL still applies to interrupted triggers.
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
}

async function clearForceTrigger() {
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(join(agentDir, ".force-trigger.json"));
  } catch (error) {
    logDebug(agentDir, `[stop] clearForceTrigger failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function isPaused() {
  try {
    await access(join(agentDir, ".paused"));
    return true;
  } catch {
    return false;
  }
}

/** Build the activation instruction injected into the main session. */
function buildActivationInstruction({ ids, names, transcriptPath, maxChars, budgetSeconds, reason }) {
  const maxCharsArg = maxChars === null ? "" : ` ${maxChars}`;
  return `<shadow-activation>
本回合命中影子审阅（触发：${reason}）。请在本回合内执行：
1. 对下列每个影子 id：Read 定义文件 ${agentDir}/<id>.md，取得职责正文与名称。核实仓库时优先使用轨迹中的绝对路径（本轮改动可能不在你的当前工作目录）。
2. 生成净化轨迹：运行 node "${pluginDir}/bin/serialize-transcript.mjs" "${transcriptPath}"${maxCharsArg}（输出即 <main-agent-trajectory> 文本；把它原样放入影子提示词，不要改写）。
3. 为每个影子启动一个【后台】subagent（Agent 工具，不要阻塞回合）：提示词 = 轨迹文本 + 影子协议 + <shadow-mind id="<id>" name="<name>">职责正文</shadow-mind> + ${timeBudgetLine(budgetSeconds)}。影子定义 .claude/agents/shadow-<id>.md 已限制只读工具与轮数（若缺失，先运行 /shadow sync-agents 再继续；仍缺失则跳过该影子并说明原因）。
4. 收到完成通知后：汇总各影子报告并处理（验证/修正/告知用户），不要等待用户指令。
</shadow-activation>`;
}

const input = await readStdinJson();
if (process.env.CLAUDE_CODE_SHADOW_MIND === "1") process.exit(0);

const output = await main(input);
if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
process.exit(0);

async function main(input) {
  const sessionId = input?.session_id ?? input?.sessionId ?? "unknown";
  const log = (line) => logDebug(agentDir, `[stop:${sessionId.slice(0, 8)}] ${line}`);

  try {
    if (input?.stop_hook_active === true) {
      log("stop_hook_active=true; skipping to avoid block loop");
      return null;
    }

    const configStore = new ConfigStore();
    await configStore.initialize();
    const { config, error } = await configStore.reload();
    if (error) log(`config error: ${error}`);

    const registry = new ShadowRegistry();
    const snapshot = await registry.load();
    if (snapshot.diagnostics.length) {
      log(`registry diagnostics: ${snapshot.diagnostics.map((d) => d.message).join("; ")}`);
    }

    if (await isPaused()) {
      log("paused; skip");
      return null;
    }

    // Explicit /shadow now trigger (one-shot, TTL-guarded).
    let force = await readForceTrigger();
    if (force) {
      if (!forceTriggerValid(force)) {
        log("force trigger expired; discarding");
        await clearForceTrigger();
        return null;
      }
      await clearForceTrigger();
    }

    // Extension auto trigger: only when no explicit force exists.
    if (!force && config.auto_review_enabled && config.auto_review_exts.length) {
      if (await touchMatchingExt(input?.transcript_path, config.auto_review_exts)) {
        force = { id: "*", at: Date.now(), reason: "auto_ext" };
        log(`AUTO review by ext: ${config.auto_review_exts.join(",")}`);
      }
    }

    if (!force) {
      log("no manual trigger; skip");
      return null;
    }

    const mainModelId = normalizeModelId(await resolveMainModelId() ?? "");
    const selected = snapshot.shadows.filter((shadow) => shadow.enabled
      && matchesModel(shadow, mainModelId)
      && (force.id === undefined || force.id === "*" || force.id === shadow.id));

    if (!selected.length) {
      log("trigger hit but no matching shadows");
      return null;
    }

    const budgetSeconds = Math.round((config.default_shadow_timeout_seconds ?? 300));
    const instruction = buildActivationInstruction({
      ids: selected.map((s) => s.id),
      names: selected.map((s) => s.name),
      transcriptPath: input?.transcript_path ?? "",
      maxChars: config.max_trajectory_chars ?? null,
      budgetSeconds,
      reason: force.reason === "auto_ext" ? "AUTO" : "FORCED",
    });
    log(`${force.reason === "auto_ext" ? "AUTO" : "FORCED"} activation instruction injected for ${selected.map((s) => s.id).join(",")}`);
    return {
      hookSpecificOutput: {
        hookEventName: "Stop",
        additionalContext: instruction,
      },
    };
  } catch (inner) {
    log(`hook error: ${inner instanceof Error ? inner.message : String(inner)}`);
    return null;
  }
}
