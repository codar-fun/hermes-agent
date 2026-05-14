<!-- deepscan:meta
commit: bf196a3fc0fd1f79353369e8732051db275c6276
generated-at: 2026-04-26T00:00:00Z
-->

# Hermes Agent

> 一个「自我进化」的 AI 智能体框架，由 Nous Research 构建，支持在任意环境（本地、VPS、容器、无服务器）运行，并通过技能创造与经验积累不断学习成长。

## 项目信息

| 字段 | 值 |
|------|----|
| 编程语言 | Python 3.11+（后端）、TypeScript / React（Web UI） |
| 框架 | OpenAI SDK（兼容层）、prompt_toolkit、FastAPI、React |
| 许可证 | MIT |
| 版本 | 0.11.0 |

Hermes Agent 是一个通用 AI 智能体，其核心特色是「闭环学习」：智能体会自动从复杂任务中提炼出可重用的技能（Skills），在运行中自我改进这些技能，并在会话之间通过持久化记忆（Memory）积累用户和环境知识。支持 200+ 模型（通过 OpenRouter 等网关），可通过 Telegram、Discord、Slack、WhatsApp、Signal 等多平台收发消息，也可在本地 CLI 交互或在 Docker/SSH/Modal/Daytona 等六种后端环境中执行任务。

## 架构概览

Hermes Agent 是一个**单体应用**，对外暴露三个入口：

1. **CLI（`cli.py`）**：带有完整 TUI（基于 prompt_toolkit）的交互式终端，调用核心的 `AIAgent` 类驱动对话。
2. **消息网关（`gateway/`）**：一个独立的长期运行进程，将多个即时通讯平台的消息统一路由至 `AIAgent`，同时承担定时任务（cron）的调度与输出投递。
3. **ACP 服务（`acp_adapter/`）**：通过 Agent Communication Protocol（JSON-RPC）将 Hermes 暴露为编辑器（VS Code 等）可调用的智能体服务。

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             入口层                                        │
│   cli.py (TUI/交互)   gateway/ (多平台消息)   acp_adapter/ (JSON-RPC)   │
└────────────────┬────────────────────┬──────────────────────┬─────────────┘
                 │                    │                      │
                 ▼                    ▼                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                     AIAgent 核心（run_agent.py）                          │
│  · 对话循环（工具调用 → 执行 → 结果回注）                                 │
│  · 系统提示构建（agent/prompt_builder.py）                                 │
│  · 上下文压缩（agent/context_compressor.py）                               │
│  · 记忆管理（agent/memory_manager.py）                                     │
│  · 多模型适配（anthropic/gemini/bedrock/codex/gemini_cloudcode adapters）   │
└────────────────┬───────────────────────────────────────────────────────  ┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    工具层（tools/ + model_tools.py）                      │
│  terminal  file_ops  web  browser  vision  skills  memory  cronjob ...   │
└──────────────────────────────────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    持久化层                                                │
│   state.db（SQLite + FTS5）   ~/.hermes/memories/   ~/.hermes/cron/      │
└──────────────────────────────────────────────────────────────────────────┘
```

## 目录结构

```
hermes-agent/
├── run_agent.py          # AIAgent 核心类，12000+ 行，对话循环驱动者
├── cli.py                # 交互式 TUI 主程序，11000+ 行
├── model_tools.py        # 工具发现 & 分发的薄协调层
├── toolsets.py           # 工具集分组定义（web/terminal/research/等）
├── hermes_constants.py   # 无依赖的全局常量与路径助手
├── hermes_state.py       # SQLite 会话存储（FTS5 全文检索）
├── hermes_logging.py     # 日志配置
├── hermes_time.py        # 时区感知的时间工具
├── utils.py              # 通用工具函数
│
├── agent/                # 从 run_agent.py 分离出的纯工具模块
│   ├── prompt_builder.py           # 系统提示组装（技能索引、记忆、上下文文件）
│   ├── context_compressor.py       # 默认上下文压缩引擎（LLM 摘要）
│   ├── context_engine.py           # 上下文引擎抽象基类
│   ├── memory_manager.py           # 记忆提供者统一管理器
│   ├── memory_provider.py          # 记忆提供者抽象基类
│   ├── anthropic_adapter.py        # Anthropic Messages API 适配器
│   ├── gemini_native_adapter.py    # Gemini 原生 API 适配器
│   ├── bedrock_adapter.py          # AWS Bedrock 适配器
│   ├── codex_responses_adapter.py  # OpenAI Codex Responses API 适配器
│   ├── gemini_cloudcode_adapter.py # Google Cloud Code 适配器
│   ├── credential_pool.py          # 多 API key 负载均衡 & 轮换
│   ├── skill_commands.py           # 斜杠命令解析与执行
│   ├── skill_utils.py              # 技能文件解析工具
│   ├── prompt_caching.py           # Anthropic 提示缓存逻辑
│   ├── rate_limit_tracker.py       # 限流检测 & 退避
│   ├── usage_pricing.py            # Token 用量与成本估算
│   ├── insights.py                 # 会话洞察生成
│   └── transports/                 # HTTP 传输层（代理、重试）
│
├── tools/                # 40+ 自注册工具模块
│   ├── registry.py       # 工具注册中心（自动发现 tools/*.py）
│   ├── terminal_tool.py  # terminal：本地/Docker/Modal/SSH/Singularity/Daytona
│   ├── file_tools.py     # read_file/write_file/patch/search_files
│   ├── delegate_tool.py  # delegate_task：并行子智能体编排
│   ├── memory_tool.py    # memory：持久化记忆读写
│   ├── skills_tool.py    # skills_list/skill_view/skill_manage
│   ├── cronjob_tools.py  # cronjob：定时任务管理
│   ├── web_tools.py      # web_search/web_extract
│   ├── browser_tool.py   # browser_navigate 等浏览器自动化工具
│   ├── session_search_tool.py  # session_search：跨会话 FTS5 检索
│   ├── mcp_tool.py       # MCP 协议工具桥接
│   └── ...               # vision、tts、image_gen、send_message 等
│
├── hermes_cli/           # CLI 辅助模块（banner、env_loader、超时配置等）
│
├── gateway/              # 消息网关
│   ├── run.py            # GatewayRunner：生命周期管理，cron 调度轮询
│   ├── session.py        # 会话存储与重置策略
│   ├── delivery.py       # 消息投递路由（cron 输出 → 指定频道）
│   ├── config.py         # 网关配置模型
│   └── platforms/        # 各平台适配器
│       ├── telegram.py   discord.py   slack.py   whatsapp.py
│       ├── signal.py     matrix.py    feishu.py  wecom.py
│       ├── email.py      sms.py       dingtalk.py
│       └── homeassistant.py
│
├── cron/                 # 定时任务系统
│   ├── jobs.py           # 任务存储（~/.hermes/cron/jobs.json）& CRUD
│   └── scheduler.py      # tick()：触发到期任务，运行 AIAgent 实例
│
├── acp_adapter/          # ACP (Agent Communication Protocol) 服务
│   └── entry.py          # JSON-RPC over stdio 的入口
│
├── plugins/              # 可插拔后端
│   ├── memory/           # 记忆提供者：honcho、mem0、byterover、supermemory 等
│   └── context_engine/   # 上下文引擎：默认 compressor，可替换为 lcm 等
│
├── skills/               # 内置技能包（GitHub、数据科学、DevOps、研究等）
├── optional-skills/      # 可选技能（区块链、安全、ML 运维等）
│
├── environments/         # Atropos RL 训练环境
│   ├── agent_loop.py     # HermesAgentLoop：可复用的多轮工具调用引擎
│   ├── hermes_swe_env/   # SWE-bench 评估环境
│   └── benchmarks/       # 各类 benchmark 适配
│
├── batch_runner.py       # 批量轨迹生成（并行，支持断点续传）
├── trajectory_compressor.py  # 轨迹压缩（训练数据处理）
├── rl_cli.py             # RL 训练专用 CLI 入口
├── tinker-atropos/       # Atropos & Tinker RL 框架（git submodule）
│
├── web/                  # React 管理仪表板（FastAPI 后端 + Vite 前端）
│   └── src/              # 会话浏览、配置、cron、技能管理等页面
├── tui_gateway/          # WebSocket TUI 服务（Ink-based 终端 UI）
├── ui-tui/               # Ink (Node.js) TUI 前端
│
├── tests/                # 测试套件（pytest）
└── packaging/            # Homebrew formula 等打包脚本
```

## 核心组件

### `AIAgent`（`run_agent.py`）

**职责**：整个系统的核心，驱动「系统提示 → 用户消息 → LLM 调用 → 工具执行 → 循环」的完整对话生命周期。

**关键文件**：`run_agent.py`（12000 行）

**内部子系统**：
- 使用 `agent/prompt_builder.py` 在每轮开始时组装系统提示（身份、平台信息、技能索引、记忆快照）。
- 通过 `agent/memory_manager.py` 管理记忆提供者，在每轮前预取（prefetch）、每轮后同步（sync）。
- 通过 `agent/context_engine.py` 抽象层（默认 `ContextCompressor`）在上下文窗口使用率达到阈值（默认 85%）时自动压缩历史。
- 多模型路由：根据 provider 配置，分别使用 `anthropic_adapter`、`gemini_native_adapter`、`bedrock_adapter`、`codex_responses_adapter` 或标准 OpenAI 兼容端点。
- 通过 `agent/credential_pool.py` 实现多 API key 自动轮换与负载均衡。

### 工具系统（`tools/` + `model_tools.py`）

**职责**：所有可调用能力（terminal、文件、Web、浏览器等）的注册、发现与分发。

**关键文件**：`tools/registry.py`、`model_tools.py`

**机制**：每个 `tools/*.py` 文件在模块级调用 `registry.register()`，声明工具名称、JSON Schema、处理函数（同步或异步）及所属 toolset。`model_tools.py` 调用 `discover_builtin_tools()` 触发全量导入，并向上层暴露 `get_tool_definitions()` 和 `handle_function_call()` 接口。

**代表性工具**：
- `terminal`（`tools/terminal_tool.py`）：支持本地/Docker/Modal/SSH/Singularity/Daytona 六种执行后端，含后台任务管理。
- `delegate_task`（`tools/delegate_tool.py`）：将子任务并行委派给独立的 `AIAgent` 实例（隔离上下文、受限 toolset）。
- `memory`（`tools/memory_tool.py`）：读写持久化记忆文件（`MEMORY.md`、`USER.md`），以 `§` 分隔条目，注入系统提示快照。
- `session_search`（`tools/session_search_tool.py`）：通过 FTS5 全文检索历史会话并用 LLM 生成摘要。
- `cronjob`（`tools/cronjob_tools.py`）：创建、暂停、触发定时任务。

### 消息网关（`gateway/`）

**职责**：将多个即时通讯平台的消息统一路由至 AIAgent，并将 cron 任务的输出投递到指定频道。

**关键文件**：`gateway/run.py`、`gateway/session.py`、`gateway/platforms/`

支持平台：Telegram、Discord、Slack、WhatsApp、Signal、Matrix、Feishu（飞书）、WeCom（企业微信）、Email、SMS、DingTalk（钉钉）、Home Assistant、QQ Bot、Mattermost、Webhook 等。

网关以 LRU 缓存管理每个平台会话对应的 `AIAgent` 实例（最多 128 个，空闲 1 小时后驱逐），每分钟 tick 一次调度器。

### 技能系统（`skills/`、`tools/skills_tool.py`）

**职责**：将可重用的操作规程（Skill）以 Markdown 文件形式存储，注入系统提示，供智能体调用。

**格式**：每个技能是一个目录，包含带 YAML frontmatter 的 `SKILL.md`（名称、描述、版本、平台限制、环境变量要求），可选附有 `references/`、`templates/`、`assets/` 子目录。技能列表索引（仅 name + description）注入系统提示，全文按需加载（`skill_view`）。兼容 [agentskills.io](https://agentskills.io) 开放标准。

### 上下文压缩（`agent/context_compressor.py`）

**职责**：当上下文窗口使用率超过阈值时，调用 LLM 对历史消息进行摘要压缩，保留首尾若干条消息不压缩，防止上下文溢出。

### 定时任务（`cron/`）

**职责**：提供 cron 表达式、间隔触发和一次性（one-shot）三种调度模式，任务以 JSON 持久化，输出保存为 Markdown 文件，可指定投递的消息平台和频道。

**关键文件**：`cron/jobs.py`、`cron/scheduler.py`

### 插件系统（`plugins/`）

**职责**：允许第三方替换记忆后端（`plugins/memory/`）和上下文引擎（`plugins/context_engine/`），无需修改核心代码。同一时间只能激活一个记忆插件（`memory.provider` in config.yaml）和一个上下文引擎（`context.engine`）。

内置记忆插件：`honcho`、`mem0`、`byterover`、`holographic`、`hindsight`、`openviking`、`retaindb`、`supermemory`。

### RL/研究组件（`environments/`、`batch_runner.py`）

**职责**：为强化学习训练数据生成与评估提供支持。`HermesAgentLoop`（`environments/agent_loop.py`）是一个可复用的多轮 tool-calling 引擎，被 Atropos RL 环境（`tinker-atropos/`）调用。`batch_runner.py` 支持并行批量运行 agent 并生成轨迹，含断点续传能力。

## 数据结构与模型

### 会话数据库（`hermes_state.py`）

SQLite 数据库（`~/.hermes/state.db`），WAL 模式，FTS5 全文检索：

| 表 | 说明 |
|----|------|
| `sessions` | 会话元数据（model、cost、token 用量、来源平台、父会话 ID 等） |
| `messages` | 每条消息（role、content、tool_calls、timestamp） |
| `fts_messages` | FTS5 虚拟表，为 session_search 工具提供全文检索 |

### 技能文件格式

```yaml
---
name: github-code-review      # 必填，≤64 字符
description: ...              # 必填，≤1024 字符
version: 1.0.0
platforms: [linux, macos]     # 可选，限定平台
prerequisites:
  env_vars: [GITHUB_TOKEN]
---
# 技能正文（Markdown）
```

### 记忆文件格式

`~/.hermes/memories/MEMORY.md` 和 `USER.md` 均以 `§`（Section Sign）作为条目分隔符，条目可多行。系统提示注入只使用启动时的快照，当轮写入不影响当前 session 的系统提示（保护 prefix cache）。

### 定时任务 JSON（`~/.hermes/cron/jobs.json`）

每个 job 字段包括：id、name、schedule（cron 表达式/间隔秒数）、prompt、enabled、toolsets、skills、delivery（platform/channel）、last_run、next_run 等。

## 数据流

**一个用户消息从输入到响应的完整生命周期**：

1. **用户输入**：CLI 的 prompt_toolkit 组件捕获输入（或 gateway 从平台接收事件），提取斜杠命令（`/skills`、`/model`等）或普通消息。

2. **系统提示组装**：`AIAgent._build_system_prompt()` 调用 `agent/prompt_builder.py`，合并：基础身份提示 + 技能索引（从 `~/.hermes/skills/` 扫描）+ 记忆快照（`MEMORY.md`、`USER.md`）+ 可选的 Honcho/mem0 上下文 + 平台上下文提示。

3. **记忆预取**：`MemoryManager.prefetch_all()` 触发所有已注册的记忆提供者，将相关记忆作为 `<memory-context>` 块临时注入用户消息前（不持久化）。

4. **LLM 调用**：根据 provider 配置选择适配器（OpenAI wire 协议 / 原生 Anthropic / Gemini / Bedrock），携带完整消息历史和工具 schema 发起 API 请求；`agent/rate_limit_tracker.py` 监控限流，`agent/prompt_caching.py` 处理 Anthropic prompt cache。

5. **工具调用循环**：模型返回包含 `tool_calls` 的响应，`model_tools.handle_function_call()` 查询注册中心分发至对应工具；工具结果以 `tool` role 消息追加，重新请求 LLM；循环至模型不再发起工具调用或达到最大轮次。

6. **上下文压缩检查**：每轮完成后，`ContextEngine.should_compress()` 检查 token 使用率；若超阈值则调用 `compress()` 对中间历史进行 LLM 摘要，压缩后继续对话。

7. **记忆同步**：`MemoryManager.sync_all()` 触发异步写入（用户消息 + AI 回复），记忆提供者决定是否更新持久化文件。

8. **响应渲染**：CLI 用 rich 渲染 Markdown、工具输出、token 用量；gateway 将纯文本格式化后发回对应平台。

## API 与接口

### 公共 CLI 命令

```bash
hermes                        # 启动交互式对话
hermes model                  # 选择 LLM 提供者和模型
hermes tools                  # 配置启用的工具集
hermes config set <key> <val> # 设置单个配置项
hermes gateway                # 启动消息网关（前台运行）
hermes gateway start/stop     # 作为系统服务管理网关
hermes cron list              # 列出定时任务
hermes setup                  # 全交互式安装向导
hermes doctor                 # 诊断配置与依赖
hermes acp                    # 以 ACP 服务器模式运行
hermes update                 # 更新到最新版本
hermes sessions browse        # 交互式会话选择器
```

### 会话内斜杠命令

| 命令 | 说明 |
|------|------|
| `/new` `/reset` | 开始新对话 |
| `/model [provider:model]` | 切换模型 |
| `/compress` | 手动压缩上下文 |
| `/skills` | 浏览可用技能 |
| `/personality [name]` | 切换人格配置 |
| `/stop` | 中断当前工具执行 |
| `/usage` | 查看 token 用量和成本 |
| `/insights` | 会话洞察报告 |

### 工具注册接口（`tools/registry.py`）

```python
registry.register(
    name="my_tool",
    toolset="web",
    schema={...},          # JSON Schema
    handler=my_handler,    # 同步或 async 函数
    check_fn=None,         # 可选：运行时可用性检查
    requires_env=[],       # 必需的环境变量
    emoji="🔧",
)
```

### AIAgent Python API（`run_agent.py`）

```python
from run_agent import AIAgent

agent = AIAgent(
    base_url="https://openrouter.ai/api/v1",
    model="anthropic/claude-opus-4.6",
)
response = agent.run_conversation("请帮我搜索最新的 Python 新闻")
```

### 记忆提供者接口（`agent/memory_provider.py`）

所有记忆插件需实现：`build_system_prompt()`、`prefetch(user_message)`、`sync(user_msg, ai_response)`。

## 核心功能

- **多模型支持**：通过 OpenRouter（200+ 模型）、Nous Portal、Anthropic、OpenAI、Gemini、Bedrock、NVIDIA NIM、本地 Ollama/vLLM 等无缝切换，`hermes model` 命令无需改代码。
- **自进化技能系统**：智能体可从复杂任务中提炼 `SKILL.md` 文件，后续会话自动加载；内置 GitHub、数据科学、DevOps、研究等技能包，兼容 agentskills.io 开放标准。
- **跨会话持久记忆**：`MEMORY.md`（环境/约定知识）+ `USER.md`（用户偏好画像）以条目方式持久化，可对接 Honcho（辩证用户建模）、mem0、supermemory 等第三方记忆后端。
- **六种执行后端**：terminal 工具支持本地直接执行、Docker 容器隔离、Modal 无服务器沙箱、SSH 远程、Daytona 和 Singularity，`TERMINAL_ENV` 环境变量一键切换。
- **并行子智能体**：`delegate_task` 工具可将任务拆解并并行委派给多个独立的子 `AIAgent` 实例，父智能体只看到摘要结果。
- **多平台消息网关**：单进程支持 Telegram、Discord、Slack、WhatsApp、Signal、Matrix、飞书、企业微信、Email、SMS 等，含语音消息转写（Whisper）、跨平台会话连续性。
- **定时自动化**：内置 cron 调度器，支持 cron 表达式、间隔触发、一次性任务，输出可投递至任意平台频道。
- **自动上下文压缩**：检测到上下文窗口使用率超过阈值时自动 LLM 摘要压缩历史，无需用户干预。
- **FTS5 跨会话搜索**：`session_search` 工具通过 SQLite FTS5 全文检索历史会话，用 LLM 生成语义摘要。
- **RL 研究支持**：`batch_runner.py` 并行生成训练轨迹，`environments/` 提供 Atropos 强化学习评估环境，支持 SWE-bench。
- **Web 管理界面**：React 仪表板（`web/`），提供会话浏览、配置、cron 管理、技能管理、日志查看、分析统计等功能；可通过 FastAPI 后端（`agent/insights.py` 等）访问运行时状态。

## 快速开始

```bash
# 安装（推荐）
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash

# 开发安装
pip install -e ".[all]"

# 配置（选一种提供者）
echo "OPENROUTER_API_KEY=your-key" > ~/.hermes/.env
# 或
echo "ANTHROPIC_API_KEY=your-key" >> ~/.hermes/.env

# 选择模型
hermes model

# 启动交互式对话
hermes

# 启动消息网关（后台服务）
hermes gateway install
hermes gateway start
```

Android / Termux 用户请安装 `.[termux]` extra（不含语音依赖），Windows 用户需通过 WSL2 运行。

## 配置

主配置文件：`~/.hermes/config.yaml`（参考 `cli-config.yaml.example`）

| 配置项 | 说明 |
|--------|------|
| `model.default` | 默认模型，如 `anthropic/claude-opus-4.6` |
| `model.provider` | 推理提供者：`auto`/`openrouter`/`anthropic`/`gemini` 等 |
| `model.base_url` | OpenAI 兼容端点 URL |
| `context.engine` | 上下文引擎：`compressor`（默认）或插件名 |
| `memory.provider` | 记忆后端：`builtin`/`honcho`/`mem0` 等 |
| `network.force_ipv4` | IPv6 不可用时强制 IPv4（`true`/`false`） |
| `model.reasoning_effort` | 推理力度：`none`/`low`/`medium`/`high`/`xhigh` |

支持多配置文件（Profile）：`hermes --profile coder`，每个 profile 使用独立的 `~/.hermes/profiles/<name>/` 目录。

## 测试

```bash
# 运行所有单元测试（默认跳过 integration）
pytest

# 并行运行
pytest -n auto

# 运行 integration 测试（需要 API key）
pytest -m integration
```

测试位于 `tests/`，按模块分子目录：`tests/agent/`、`tests/tools/`、`tests/gateway/`、`tests/cron/` 等。大量使用 `unittest.mock` 对 LLM 调用打桩，对工具调用则测试真实逻辑。

## 值得关注的模式与决策

### 1. 工具自注册模式（`tools/registry.py`）

所有工具文件在模块级调用 `registry.register()`，`discover_builtin_tools()` 通过 AST 静态分析检测哪些文件包含顶层 `registry.register()` 调用后再批量导入，避免导入无关模块。好处是新增工具只需新建文件无需修改中心列表，但也意味着工具文件的模块级代码会在首次工具初始化时全部执行。

### 2. 持久异步事件循环（`model_tools.py`）

`_run_async()` 为主线程维护一个持久的 `asyncio.EventLoop`（而非每次 `asyncio.run()` 创建新 loop），防止 httpx/AsyncOpenAI 等缓存了 loop 引用的客户端在 GC 时抛出"Event loop is closed"。工作线程（delegate 子线程池）各自维护线程本地的持久 loop，三者相互隔离。

### 3. 记忆快照不中途更新（`tools/memory_tool.py`）

记忆写入立即落盘，但当前会话的系统提示只在下次启动时刷新。这是刻意的设计：系统提示稳定保证 Anthropic prompt cache 在整个 session 中命中，避免每次写记忆导致 cache 失效从而大幅增加 token 消耗。

### 4. 上下文引擎插件化（`plugins/context_engine/`）

默认 `ContextCompressor` 使用 LLM 做 summarization 压缩，但整个接口通过抽象基类 `ContextEngine` 暴露，可替换为基于 DAG 的 LCM 引擎或任意第三方实现，通过 `context.engine: <name>` 配置项无缝切换，运行时不需要重启服务（只在 session 开始时加载）。
