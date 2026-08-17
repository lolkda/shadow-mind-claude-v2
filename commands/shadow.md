---
description: Manage Shadow Mind v2 background shadow agents (now, pause, resume, status, list, create, delete, config, sync-agents).
---

# Shadow Mind (v2)

管理 Shadow Mind v2 后台影子智能。用法: /shadow status|pause|resume|now [id]|list|create|delete|config get|set|sync-agents

说明: now [id] 是显式强制触发——本回合 Stop hook 会注入激活指令,主 Agent 拉起后台影子 subagent;影子完成后**完成通知自动唤醒主 Agent 处理报告,无需用户开口**。

自动触发(可选): `config set auto_review_enabled true` 后,本回合**写操作动过** `auto_review_exts` 中后缀的文件(Write/Edit/MultiEdit/NotebookEdit,命令文本不算)会自动激活全部影子审阅(日志标记 AUTO);改其他文件或只读浏览不触发。

sync-agents: 把 shadow-minds 定义同步生成到项目 `.claude/agents/shadow-<id>.md`(只读工具白名单 + maxTurns 限制)。新增/编辑/删除影子定义后需重新运行。

先读取 C:/Users/Administrator/.claude/shadow-mind.json 中的 "pluginDir" 字段获得插件绝对路径
(该文件由 install.mjs 在插件安装时写入),然后执行:

node "<pluginDir>/bin/admin.mjs" $ARGUMENTS

向用户汇报 admin.mjs 的输出,不要自行猜测参数。涉及删除(shadow delete)前先向用户确认。
