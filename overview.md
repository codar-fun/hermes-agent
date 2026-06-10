<!-- deepscan:meta
commit: 3c231eb3979ab9c57d5cd6d02f1d577a3b718b43
generated-at: 2026-06-10T06:23:37Z
-->

# Hermes Agent ☤

> A self-improving, model-agnostic AI agent that runs anywhere — terminal, messaging platforms, cloud sandboxes — and learns from its own experience by creating and refining skills.

## Project Info

| Field | Value |
|-------|-------|
| Language(s) | Python 3.11–3.13 (core), TypeScript/React (TUI, desktop, website, dashboard) |
| Frameworks | OpenAI SDK (chat shape), FastAPI/uvicorn, prompt_toolkit + Rich (CLI), Ink (TUI), Electron (desktop), Docusaurus (docs) |
| License | MIT |
| Version | 0.16.0 (Python pkg) |
| Author | Nous Research |
| Scale | ~1M LOC Python · 82 tool modules · 31 gateway platforms · 29 model-provider plugins · 74 built-in + 95 optional skills · ~1,400 test files |

Hermes is an agentic AI runtime built around a single synchronous tool-calling loop that works with *any* OpenAI-compatible (or natively-adapted) model provider. Its distinguishing feature is a **closed learning loop**: it curates persistent memory, autonomously authors and improves "skills" (procedural memory), searches its own past conversations, and builds a model of the user across sessions. It runs as an interactive terminal app, as a multi-platform messaging gateway (Telegram, Discord, Slack, …), on cron schedules, and across six terminal backends from local shell to serverless cloud sandboxes.

## Architecture Overview

Hermes is a **modular monolith**: one Python codebase with several entry points sharing a common agent core. The pieces fit together in layers.

```
┌───────────────────────────────────────────────────────────────────────────┐
│  FRONTENDS                                                                  │
│  hermes (classic CLI)  │  hermes --tui (Ink+JSON-RPC)  │  apps/desktop      │
│  gateway (Telegram/Discord/Slack/…)  │  acp_adapter (editors)  │  dashboard │
└───────────────────────────────┬───────────────────────────────────────────┘
                                 │  all construct an
                                 ▼
                   ┌─────────────────────────────┐
                   │  AIAgent  (run_agent.py)     │  the conversation loop
                   │  run_conversation()          │  (sync, interrupt-aware,
                   │  agent/conversation_loop.py  │   budget-tracked)
                   └───┬───────────┬───────────┬──┘
        model call     │           │ tool call │  post-turn hooks
                       ▼           ▼           ▼
        ┌──────────────────┐ ┌───────────┐ ┌──────────────────────┐
        │ transports/ +    │ │model_tools│ │ curator / memory /   │
        │ provider adapters│ │ .py +     │ │ background_review     │
        │ (anthropic,      │ │ registry +│ │ (learning loop)       │
        │  bedrock, gemini,│ │ toolsets  │ └──────────────────────┘
        │  codex, …)       │ └─────┬─────┘
        └──────────────────┘       ▼
                          ┌──────────────────────┐
                          │ tools/*.py (82)      │
                          │ tools/environments/  │ local│docker│ssh│
                          │  (terminal backends) │ modal│daytona│singularity
                          └──────────────────────┘

  Cross-cutting: hermes_state.py (SQLite+FTS5 sessions) · cron/ (scheduler) ·
  plugins/ (memory · model-providers · platforms · context_engine · …) ·
  skills/ (procedural memory) · MCP integration
```

**Three discovery/registry systems** keep the core decoupled and extensible, all using the same pattern (declare-at-import, no central edit list):
1. **Tools** — `tools/registry.py` (`registry.register(...)` at import time).
2. **Plugins** — `hermes_cli/plugins.py` `PluginManager` (memory, context-engine, model-provider, platform, standalone).
3. **Providers / Platforms** — `providers/__init__.py` and `gateway/platform_registry.py` (lazy, self-registering).

## Directory Structure

```
hermes-agent/
├── run_agent.py            # AIAgent class — the core conversation loop (~5k LOC; loop body in agent/)
├── cli.py                  # HermesCLI — classic interactive terminal UI (~16k LOC)
├── model_tools.py          # Tool orchestration: discover_builtin_tools(), handle_function_call()
├── toolsets.py             # Toolset definitions + resolution (_HERMES_CORE_TOOLS, resolve_toolset())
├── hermes_state.py         # SessionDB — SQLite session store with FTS5 search (schema v14)
├── hermes_constants.py     # get_hermes_home() / display_hermes_home() — profile-aware paths
├── hermes_logging.py       # setup_logging() — agent.log / errors.log / gateway.log
├── trajectory_compressor.py, batch_runner.py, mini_swe_runner.py  # research / training data tooling
├── agent/                  # Agent internals: provider adapters, loop, memory, compression, credentials
│   ├── transports/         #   pluggable per-api_mode message/tool format conversion
│   ├── lsp/                #   Language Server Protocol integration (pyright, gopls, …)
│   └── secret_sources/     #   external secret backends (e.g. Bitwarden)
├── hermes_cli/             # CLI subcommands, setup wizard, plugin loader, skin engine, dashboard
├── tools/                  # 82 tool implementations — auto-discovered
│   └── environments/       #   terminal backends: local, docker, ssh, modal, daytona, singularity
├── gateway/                # Messaging gateway — run.py + session.py + platforms/ (31 adapters)
├── providers/              # Model-provider profile base (plugins/model-providers/ register here)
├── plugins/                # Plugin system (memory, model-providers, context_engine, kanban, …)
├── skills/                 # 74 built-in skills (procedural memory, SKILL.md format)
├── optional-skills/        # 95 heavier/niche skills shipped but inactive by default
├── cron/                   # Cron scheduler — jobs.py, scheduler.py
├── acp_adapter/            # Agent Client Protocol server (VS Code / Zed / JetBrains)
├── tui_gateway/            # Python JSON-RPC backend for the Ink TUI
├── ui-tui/                 # Ink (React) terminal UI — `hermes --tui`
├── apps/desktop/           # Electron + React desktop chat app
├── web/                    # Dashboard SPA (xterm.js terminal + sidebars)
├── locales/                # i18n YAML catalogs
├── docker/, nix/, packaging/, scripts/  # build, packaging, dev tooling
├── website/                # Docusaurus documentation site
└── tests/                  # ~1,400 pytest files
```

## Core Components

### AIAgent — the conversation loop
- **Responsibility**: owns one conversation: builds the system prompt, calls the model, dispatches tool calls, tracks an iteration budget, handles interrupts/fallbacks, and triggers compression and post-turn learning hooks.
- **Key files**: `run_agent.py` (the `AIAgent` class, ~60-param `__init__`), `agent/conversation_loop.py` (the extracted loop body, ~3.9k LOC), `agent/agent_init.py` (setup, api_mode selection), `agent/iteration_budget.py` (parent cap 90, subagent cap 50; `execute_code` iterations refunded).
- **Entry methods**: `chat(message) -> str` (simple) and `run_conversation(user_message, …) -> dict` (full). Messages use OpenAI format; reasoning is stored in `assistant_msg["reasoning"]`.
- **Depends on**: transports/adapters, model_tools, context engine, memory manager, curator.

### Model adapter / transport layer
- **Responsibility**: translate the canonical chat loop to each provider's wire format, selected by `api_mode`.
- **Key files**: `agent/transports/*` (registry, lazy-discovered) and the adapters — `anthropic_adapter.py` (Messages API), `bedrock_adapter.py` (Bedrock Converse + IAM/guardrails), `codex_responses_adapter.py` (OpenAI Responses / Codex / xAI), `gemini_native_adapter.py` + `gemini_cloudcode_adapter.py` (Gemini & Cloud Code Assist), `azure_identity_adapter.py` (Entra ID keyless), `codex_runtime.py`.
- **Selection** (`agent/agent_init.py`): explicit `api_mode` wins → provider/URL detection → model-triggered upgrade (GPT-5.x → `codex_responses`) → default `chat_completions`.
- **Inference backends** themselves are plugins under `plugins/model-providers/<name>/` (openrouter, anthropic, deepseek, nvidia, gmi, …; 29 of them), each calling `register_provider(ProviderProfile(...))`.

### Tool system
- **Responsibility**: register, expose, and dispatch the agent's ~82 tools.
- **Key files**: `tools/registry.py` (`ToolRegistry` singleton, `ToolEntry`, 30s-TTL `check_fn` availability cache), `model_tools.py` (`get_tool_definitions()`, `handle_function_call()`, `_run_async()` sync↔async bridge, `coerce_tool_args()`), `toolsets.py` (`TOOLSETS` dict, recursive `resolve_toolset()` with cycle/diamond handling, `_HERMES_CORE_TOOLS`).
- **Progressive disclosure**: when non-core (MCP/plugin) tools exceed the context budget, they hide behind `tool_search` / `tool_describe` / `tool_call` bridge tools (`tools/tool_search.py`).
- **Depends on**: every `tools/*.py` (each self-registers at import), plugins, MCP.

### Terminal backends (environments)
- **Responsibility**: execute shell/`terminal` commands and `execute_code` across six environments under a common abstraction.
- **Key files**: `tools/environments/base.py` (`BaseEnvironment` ABC — spawn-per-call model, session snapshot re-sourced before each command, CWD persistence, activity heartbeats), plus `local.py`, `docker.py`, `ssh.py`, `modal.py` / `managed_modal.py`, `daytona.py`, `singularity.py`, and `file_sync.py` for remote sync. Modal and Daytona offer serverless hibernate-on-idle persistence.

### Messaging gateway
- **Responsibility**: run one process that talks to many chat platforms, mapping inbound messages to agent sessions and streaming responses back.
- **Key files**: `gateway/run.py` (boot, LRU agent cache ≤128 sessions/1h idle TTL, mention filtering), `gateway/session.py` (`SessionSource`, system-prompt context injection, PII redaction), `gateway/platform_registry.py` + `gateway/platforms/base.py` (`BasePlatformAdapter` ABC), `gateway/delivery.py` (`DeliveryTarget` routing), `gateway/stream_consumer.py` (sync→async progressive edits), `gateway/pairing.py` (code-based DM authorization), `gateway/hooks.py` (filesystem lifecycle hooks).
- **31 platform adapters**: telegram, discord, slack, whatsapp, signal, matrix, email, sms, homeassistant, feishu, dingtalk, wecom, weixin, qqbot, bluebubbles (iMessage), yuanbao, msgraph (Teams), webhook, api_server, …

### Learning loop (memory + skills + curator)
- **Responsibility**: turn experience into reusable knowledge.
- **Key files**: `agent/curator.py` (background skill lifecycle — inactivity-triggered reviews, state transitions) + `agent/curator_backup.py` (snapshot/rollback), `agent/background_review.py` (forked daemon agent that, post-turn, decides whether to save a skill/memory with a whitelisted toolset), `tools/memory_tool.py` (MEMORY.md persistence), `agent/insights.py` (session analytics, `/insights`). External memory backends plug in via `agent/memory_provider.py` ABC + `agent/memory_manager.py` (honcho, mem0, supermemory, hindsight, …).

### Skills system
- **Responsibility**: procedural memory — Markdown playbooks (`SKILL.md` + references/templates/scripts/assets) the agent and user can invoke as slash commands.
- **Key files**: `tools/skills_tool.py` (`skills_list` metadata-first / `skill_view` full), `tools/skill_manager_tool.py` (agent CRUD: create/edit/patch/delete/write_file), `tools/skills_hub.py` (install from GitHub/optional-skills, provenance lock, AST audit, quarantine). Skills live in `skills/<category>/<name>/SKILL.md`; the self-improving loop lets the agent author and refine them.

### Session store
- **Responsibility**: persist all sessions and messages for resume + cross-session search.
- **Key file**: `hermes_state.py` (`SessionDB`, SQLite WAL + FTS5, schema v14; compression-triggered session splitting via `parent_session_id` chains; source tagging `cli`/`telegram`/…). Powers `session_search` (`tools/session_search_tool.py`).

### Cron scheduler
- **Responsibility**: run scheduled/interval jobs unattended and deliver results to any platform.
- **Key files**: `cron/scheduler.py` (`tick()` called every 60s by the gateway; file-lock so only one tick runs), `cron/jobs.py` (job model). Surfaced via `tools/cronjob_tools.py` and `hermes cron`.

## Data Structures & Models

| Entity | Where | What it holds |
|--------|-------|---------------|
| `AIAgent` | `run_agent.py` | The live conversation: messages, model/credentials, toolsets, budget, callbacks, session context. |
| `ToolEntry` / `ToolRegistry` | `tools/registry.py` | name, toolset, JSON schema, handler, `check_fn`, async flag, max result size, dynamic schema overrides. |
| `TOOLSETS` | `toolsets.py` | Named tool groups with `tools` + `includes` (composable); platform toolsets like `hermes-cli`, `hermes-telegram`, union `hermes-gateway`. |
| Session row | `hermes_state.py` | session id, parent_session_id, source/platform tags, model config, full message history, FTS5-indexed text. |
| `SessionSource` | `gateway/session.py` | platform, chat_id, user_id, thread_id — message origin, injected into the system prompt. |
| `PlatformEntry` | `gateway/platform_registry.py` | adapter factory + metadata (auth env vars, validation, cron home-channel, PII flags). |
| `ProviderProfile` | `providers/base.py` | inference backend metadata (base_url, auth, api_mode hints) registered by model-provider plugins. |
| `CommandDef` | `hermes_cli/commands.py` | one slash command (name, description, category, aliases, args_hint, gateway/cli gating) — single source of truth for CLI/gateway/Telegram/Slack menus. |
| Skill | `skills/<cat>/<name>/SKILL.md` | YAML frontmatter (name, description, version, platforms, prerequisites, tags) + Markdown instructions + linked files. |
| Cron job | `cron/jobs.py` | schedule (cron/interval), prompt, delivery target, enable state. |

## Data Flow

**A messaging turn, end to end** (`gateway/run.py` → `AIAgent` → platform):

1. A user sends a message on, say, Telegram. The platform adapter (`gateway/platforms/telegram.py`, subclass of `BasePlatformAdapter`) receives it and normalizes it into a `SessionSource`.
2. The gateway checks DM authorization via `gateway/pairing.py` (approved/pending codes), then resolves the session and fetches-or-creates a cached `AIAgent` (LRU, ≤128). Slash commands are resolved through `resolve_command()` against the central `COMMAND_REGISTRY`.
3. Session context (where the agent is, who it's talking to) is injected into the system prompt; prior history is loaded from `hermes_state.py`.
4. `AIAgent.run_conversation()` enters the loop in `agent/conversation_loop.py`: it builds tool schemas via `model_tools.get_tool_definitions()` (filtered by the platform's toolset), then calls the model through the `api_mode`-selected transport/adapter.
5. If the model returns tool calls, each is dispatched through `model_tools.handle_function_call()` → `registry.dispatch()`. A `terminal`/`execute_code` call runs in the configured `tools/environments/` backend; `send_message` and streaming deltas flow back out via `gateway/stream_consumer.py` as progressive message edits.
6. The loop repeats until the model returns plain content or the iteration budget / interrupt stops it. If context grows too large, `agent/context_compressor.py` summarizes middle turns and `hermes_state.py` splits the session.
7. Post-turn, `agent/background_review.py` may fork a whitelisted agent to decide whether to persist a memory or author/refine a skill — the closed learning loop. The final response is delivered to the originating chat (or a configured home channel via `gateway/delivery.py`).

The **CLI path** is the same core minus the platform layer: `cli.py` (`HermesCLI`) or the Ink TUI (`ui-tui/` ↔ `tui_gateway/` over JSON-RPC) constructs the `AIAgent` directly and renders streaming output locally.

## API & Interfaces

### CLI (`hermes` → `hermes_cli/main.py`)
```bash
hermes                       # interactive chat (classic CLI)
hermes --tui                 # Ink terminal UI
hermes model [provider:model]   # choose model (no code change, no lock-in)
hermes tools                 # configure enabled toolsets
hermes gateway [start|stop|status|install]   # messaging gateway service
hermes setup [--portal]      # full setup wizard (Nous Portal one-shot optional)
hermes cron [list|status]    # scheduled jobs
hermes dashboard             # localhost SPA + embedded TUI
hermes acp                   # ACP server for editor integration
hermes sessions browse       # session picker with FTS search
hermes doctor | logs | update | claw migrate
```
Console entry points (`pyproject.toml`): `hermes` → `hermes_cli.main:main`, `hermes-agent` → `run_agent:main`, `hermes-acp` → `acp_adapter.entry:main`.

### Agent tool surface (selected, of 82)
`read_file`, `write_file`, `patch`, `search_files` · `terminal`, `process`, `execute_code` · `web_search`, `web_extract`, browser tools (`browser_navigate`/`_snapshot`/`_click`/`_cdp`/…) · `vision_analyze`, `image_generate`, `video_generate`, `text_to_speech` · `memory`, `todo`, `clarify`, `session_search` · `skills_list`/`skill_view`/`skill_manage` · `delegate_task` (subagents), `mixture_of_agents` · `send_message`, `cronjob` · platform tools (discord, homeassistant, kanban, feishu, yuanbao, spotify) · `tool_search`/`tool_describe`/`tool_call` (progressive disclosure) · MCP tools (dynamic).

### Extension contracts
- **New tool**: add `tools/your_tool.py` with a top-level `registry.register(name, toolset, schema, handler, check_fn, …)` and wire the name into a toolset in `toolsets.py`. Handlers return a JSON string.
- **New plugin**: `~/.hermes/plugins/<name>/plugin.yaml` + `__init__.py` exposing `register(ctx)`; hook into lifecycle (`pre_tool_call`, `post_tool_call`, `pre/post_llm_call`, `on_session_start/end`, …) and/or `ctx.register_tool` / `ctx.register_cli_command`. Plugins must not edit core files.
- **New platform**: register a `PlatformEntry` + `BasePlatformAdapter` subclass (see `gateway/platforms/ADDING_A_PLATFORM.md`).
- **New slash command**: one `CommandDef` in `hermes_cli/commands.py` + a branch in `HermesCLI.process_command()`; menus/autocomplete update automatically.
- **MCP**: any MCP server (stdio/HTTP/SSE) plugs in via `tools/mcp_tool.py`; tools surface through the tool-search bridge.

## Key Features

- **Model-agnostic** — one loop over Nous Portal, OpenRouter, Anthropic, Bedrock, Gemini, Codex/OpenAI, xAI, MiniMax, and custom endpoints; switch with `hermes model`.
- **Closed learning loop** — agent-curated memory, autonomous skill creation/refinement (curator + background review), FTS5 cross-session recall, optional dialectic user modeling (Honcho).
- **Lives where you do** — single gateway process serving Telegram, Discord, Slack, WhatsApp, Signal, Matrix, email, and more, with voice-memo transcription and progressive streaming edits.
- **Runs anywhere** — six terminal backends (local, Docker, SSH, Singularity, Modal, Daytona); serverless hibernation makes idle cloud agents nearly free.
- **Scheduled automation** — natural-language cron jobs delivered to any platform.
- **Delegation** — isolated subagents for parallel workstreams; `execute_code` collapses multi-step tool pipelines into zero-context-cost RPC scripts.
- **Multiple frontends** — classic CLI, Ink TUI, Electron desktop app, browser dashboard, and ACP editor integration, all over the same agent core.
- **Security-conscious** — exact-pinned dependencies (supply-chain hardening after the Mini Shai-Hulud worm), command-approval gates, DM pairing, container isolation, skill AST audits, sensitive-path deny-lists.

## Getting Started

```bash
# Install (Linux/macOS/WSL2/Termux)
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
source ~/.bashrc

# Contributor / from source
git clone https://github.com/NousResearch/hermes-agent.git
cd hermes-agent
./setup-hermes.sh          # uv venv, install .[all], symlink ~/.local/bin/hermes
./hermes                   # auto-detects the venv

# Configure & run
hermes model               # pick a provider/model (or: hermes setup --portal)
hermes                     # start chatting
hermes gateway start       # talk to it from Telegram/Discord/Slack/…
```
Reference `.env.example` for secrets and `cli-config.yaml.example` for settings.

## Configuration

- **`~/.hermes/config.yaml`** — all non-secret settings. Top-level sections: `model`, `agent`, `terminal`, `compression`, `display`, `stt`, `tts`, `memory`, `security`, `delegation`, `smart_model_routing`, `checkpoints`, `auxiliary`, `curator`, `skills`, `gateway`, `logging`, `cron`, `profiles`, `plugins`, `honcho`. Defaults live in `DEFAULT_CONFIG` (`hermes_cli/config.py`).
- **`~/.hermes/.env`** — secrets only (API keys/tokens); declared in `OPTIONAL_ENV_VARS`.
- **Three config loaders** (`load_cli_config()` in `cli.py`, `load_config()` in `hermes_cli/config.py`, and the gateway's raw YAML read) — adding a key means covering `DEFAULT_CONFIG`.
- **Paths are profile-aware** via `get_hermes_home()` / `display_hermes_home()` — never hardcode `~/.hermes`. Logs: `~/.hermes/logs/{agent,errors,gateway}.log` (browse with `hermes logs`).
- **Dependency policy**: every direct dep is exact-pinned in `pyproject.toml`; provider-specific deps are lazy-installed (`tools/lazy_deps.py`) to shrink the supply-chain blast radius.

## Testing

```bash
scripts/run_tests.sh                 # probes .venv → venv → ~/.hermes/.../venv
# pytest config (pyproject.toml): excludes `integration`, 30s per-test timeout,
# parallel per-file isolation via scripts/run_tests_parallel.py
```
~1,400 test files under `tests/` (mirrors source layout: `tests/agent`, `tests/gateway`, `tests/cli`, `tests/cron`, `tests/providers`, …). `integration`-marked tests need external services/keys; `tests/fakes` + `tests/fixtures` back the unit suite. TypeScript surfaces test with `vitest` (`ui-tui`, `apps/desktop`).

## Notable Patterns & Decisions

- **Declare-at-import registries everywhere.** Tools, plugins, providers, and platforms all self-register at import time, so adding capability never means editing a central dispatch list — but exposing a tool to an agent is still a deliberate step (its name must appear in a toolset). This keeps the core decoupled and is the single most important pattern for working in the codebase.
- **One synchronous agent loop, multiple api_modes.** The loop is intentionally synchronous (simpler interrupt/budget handling); provider differences are isolated in `agent/transports/` + adapters and selected by `api_mode`. The single tricky bridge is `model_tools._run_async()`, which gives the CLI, gateway, and worker threads each their own persistent event loop to avoid "Event loop is closed" on cached async clients.
- **Plugins must not touch core.** A hard rule (PR #5295): plugin-specific logic never lands in `run_agent.py`/`cli.py`/`gateway/run.py`/`main.py`. If the framework lacks a hook, expand the generic plugin surface. New in-tree memory providers are also closed — publish them as standalone plugin repos.
- **Supply-chain hardening is load-bearing.** After the Mini Shai-Hulud worm, every direct dependency is exact-pinned and provider-specific packages are lazy-installed at first use so a single quarantined PyPI release can't break fresh installs. Read the long comments in `pyproject.toml` before changing deps.
- **The TUI/dashboard share one chat surface.** `hermes dashboard` embeds the real `hermes --tui` over a PTY WebSocket — don't re-implement the transcript/composer in React. The Electron desktop app (`apps/desktop/`) is the one separate chat surface, talking to `tui_gateway` over JSON-RPC.
