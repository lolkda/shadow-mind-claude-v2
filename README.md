# shadow-mind (Claude Code port) — v2

v2 是 shadow-mind-claude 的重写版：**影子执行从"collector 独立进程"改为"后台 subagent"**，报告从"Stop 排水"改为**完成通知自动唤醒主 Agent**。不保留 v1 的 collector/队列/排水/孤儿清理体系，也不做兼容回退。

## 架构

```
触发(两种,机器决定):
  1) /shadow now → 写 force 文件(1h TTL)
  2) auto_review_enabled=true 且本回合动过清单后缀文件 → 合成内部 force
→ Stop hook 命中 → 注入 <shadow-activation> 指令(additionalContext)
→ 主 Agent 回合内:读定义 → 跑 serialize CLI 生成净化轨迹 → 为每个影子
  spawn 后台 subagent(.claude/agents/shadow-<id>.md,只读白名单 + maxTurns)
→ 影子独立审阅(读文件核实 → NOT_RELEVANT 静默 / 输出报告)
→ 完成 → 平台 completion notification 自动唤醒主 Agent → 主动汇报处理
```

- **主动送达**:影子完成即唤醒主 Agent,无需用户开口(平台原生机制)
- **零异步簿记**:无 collector/报告队列/state/孤儿清理——生命周期全交给平台
- **硬只读**:subagent 定义 `tools: [Read,Grep,Glob,LS]` + `disallowedTools: [Bash,Edit,Write]` + `maxTurns: 5`;轨迹由主 Agent 回合内生成,影子无 Bash
- **防递归**:subagent 回合不触发 Stop hook(实测 V1 通过)

## 安装

```powershell
node bin/install.mjs
# 重启 Claude Code;项目内运行 /shadow sync-agents 生成影子 subagent 定义
```

## 使用

```
/shadow now [id]        # 显式触发:本回合注入激活指令,报告完成即主动送达
/shadow sync-agents     # 从 shadow-minds/ 定义生成 .claude/agents/shadow-*.md
/shadow status          # 状态(配置/影子/drift/auto review)
/shadow pause|resume    # 暂停/恢复触发
/shadow config set auto_review_enabled true   # 开启后缀条件自动触发
/shadow config set auto_review_exts ["py","ts"]  # 自定义后缀(默认 50 个主流语言)
```

## 配置(config.json,位于 ~/.claude/shadow-minds/config.json)

| 键 | 默认 | 说明 |
|---|---|---|
| `default_shadow_timeout_seconds` | 300 | 影子时间预算(写入指令与 subagent 定义) |
| `default_shadow_model` | null | 影子模型(inherit=继承主会话) |
| `default_thinking_level` | "medium" | 影子 effort |
| `max_trajectory_chars` | null | 轨迹截断;null=不截断 |
| `auto_review_enabled` | false | 后缀条件自动触发开关 |
| `auto_review_exts` | 主流语言 50 个 | 触发后缀(带点/不带点等价、大小写不敏感) |

## 与 v1 的差异

- 执行:collector + `claude -p` 独立进程 → 后台 subagent(同进程)
- 送达:Stop 排水(需等下一回合)→ 完成通知自动唤醒(零等待)
- 记忆:v1 `reuse` 持久会话 → v2 每次全新上下文(ephemeral)
- headless:不再支持(后台 subagent 依赖交互式会话)
- 维护:18 个模块 → 16 个(删 collector/runner/reports/state/input-hook/session-end,新增 serialize/sync-agents/protocol)

## 测试

```powershell
npm test    # node --test test/*.test.mjs
```
