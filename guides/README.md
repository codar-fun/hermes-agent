# Hermes Agent 中文使用指南

> 本目录是 Hermes Agent 的中文使用文档，覆盖**安装、使用、配置、连接方式**。
> 面向最终用户与运维人员，内容基于源码核对（commit `3c231eb39`，v0.16.0）。

Hermes Agent 是 [Nous Research](https://nousresearch.com) 打造的**自我进化型 AI 智能体**：它围绕一个统一的工具调用循环运行，可以接入任意大模型供应商，既能在终端里交互，也能作为消息网关常驻在 Telegram / Discord / Slack 等平台，还能按定时任务无人值守地运行。它的特色是一条**闭环学习链**——会从经验中沉淀「技能（skill）」、维护长期记忆、检索自己的历史会话，并跨会话建立对你的理解。

---

## 文档索引

| # | 文档 | 内容 |
|---|------|------|
| 00 | 本文（README） | 总览与导航 |
| 01 | [安装与快速开始](./01-安装与快速开始.md) | 一键安装、从源码安装、首次对话、目录结构 |
| 02 | [命令行与交互](./02-命令行与交互.md) | `hermes` 子命令、斜杠命令（slash command）全表、TUI |
| 03 | [配置详解](./03-配置详解.md) | `config.yaml` 各配置段、`.env` 密钥、多 Profile 隔离 |
| 04 | [模型与提供商](./04-模型与提供商.md) | `hermes model`、内置供应商与 API Key、Nous Portal、回退/辅助模型 |
| 05 | [消息网关与平台连接](./05-消息网关与平台连接.md) | 网关启动、各平台连接凭据、用户授权与配对、Home 频道 |
| 11 | [网关详解：频道/线程与多用户](./11-网关详解-频道线程与多用户.md) | 网关功能全貌、会话键、channel/thread 上下文区分、回复与 mention 配置、多用户聊天室上下文 |
| 06 | [工具与终端后端](./06-工具与终端后端.md) | 工具集（toolset）、六种终端后端、浏览器/语音/图像等工具 |
| 13 | [工具与终端后端详解](./13-工具与终端后端详解.md) | 工具集完整目录、文件/网页/terminal/execute_code 参数与限制、六种后端逐一配置键、委派子智能体、输出限制 |
| 07 | [技能、记忆与学习闭环](./07-技能记忆与学习闭环.md) | 技能系统、Skills Hub、长期记忆、Curator 自维护 |
| 08 | [定时任务与自动化](./08-定时任务与自动化.md) | Cron 调度、平台投递、无人值守自动化 |
| 09 | [MCP 与插件扩展](./09-MCP与插件扩展.md) | 接入 MCP 服务器、插件系统、ACP 编辑器集成 |
| 12 | [MCP 管理详解](./12-MCP管理详解.md) | `hermes mcp` 全部子命令、配置 schema、工具过滤、OAuth、Sampling、目录一键安装 |
| 10 | [安全与权限](./10-安全与权限.md) | 命令审批、YOLO、沙箱隔离、密钥管理、供应链加固 |

---

## 5 分钟上手

```bash
# 1. 安装（Linux / macOS / WSL2 / Termux）
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
source ~/.bashrc

# 2. 选模型（二选一）
hermes setup --portal     # 用 Nous Portal 一键搞定（模型 + 工具网关）
hermes model              # 或手动挑选供应商和模型（需自备 API Key）

# 3. 开始对话
hermes

# 4.（可选）让它常驻消息平台
hermes gateway setup      # 配置 Telegram / Discord / Slack 等
hermes gateway start      # 后台启动网关
```

---

## 核心概念速记

- **CLI 与网关是两个入口**：`hermes` 进入终端交互；`hermes gateway` 让你从消息平台跟它对话。很多斜杠命令两边通用。
- **模型无锁定**：用 `hermes model` 随时切换供应商/模型，不改一行代码。
- **配置在 `~/.hermes/`**：`config.yaml` 放设置，`.env` 只放密钥；日志在 `~/.hermes/logs/`。
- **技能 = 程序性记忆**：`~/.hermes/skills/` 下的 Markdown 手册，可被 `/<技能名>` 调用，智能体也会自动创建和改进它们。
- **一切路径感知 Profile**：用 `HERMES_HOME` / Profile 可跑多个完全隔离的实例。

> 官方完整文档（英文）：<https://hermes-agent.nousresearch.com/docs/>
> 仓库架构总览见根目录 [`overview.md`](../overview.md)。
