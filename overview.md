# Hermes Agent — Comprehensive Architecture Overview

> Self-improving AI agent framework by [Nous Research](https://nousresearch.com). Version 0.7.0.  
> Repository: https://github.com/NousResearch/hermes-agent

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Core Components](#3-core-components)
   - 3.1 [AIAgent — Core Conversation Loop](#31-aiagent--core-conversation-loop)
   - 3.2 [HermesCLI — Interactive Terminal UI](#32-hermescli--interactive-terminal-ui)
   - 3.3 [Messaging Gateway](#33-messaging-gateway)
   - 3.4 [Tool System & Registry](#34-tool-system--registry)
   - 3.5 [Toolsets](#35-toolsets)
   - 3.6 [Slash Command Registry](#36-slash-command-registry)
   - 3.7 [Session Storage](#37-session-storage)
   - 3.8 [Memory System](#38-memory-system)
   - 3.9 [Skills System](#39-skills-system)
   - 3.10 [Cron Scheduler](#310-cron-scheduler)
   - 3.11 [Terminal Backends](#311-terminal-backends)
   - 3.12 [MCP Integration](#312-mcp-integration)
   - 3.13 [ACP Adapter](#313-acp-adapter)
   - 3.14 [Skin/Theme Engine](#314-skintheme-engine)
4. [Data Structures & Models](#4-data-structures--models)
5. [Data Flow](#5-data-flow)
6. [Configuration System](#6-configuration-system)
7. [Key APIs & Interfaces](#7-key-apis--interfaces)
8. [Tool Catalogue](#8-tool-catalogue)
9. [Platform Support Matrix](#9-platform-support-matrix)
10. [Research & RL Infrastructure](#10-research--rl-infrastructure)
11. [Usage Guide](#11-usage-guide)
12. [Extension Guide](#12-extension-guide)

---

## 1. Project Overview

Hermes Agent is a multi-platform, self-improving AI agent with a closed learning loop. Its distinguishing properties:

| Property | Details |
|---|---|
| **Learning loop** | Creates skills from experience; skills self-improve during use; FTS5 session search with LLM summarization for cross-session recall |
| **Multi-platform** | CLI, Telegram, Discord, Slack, WhatsApp, Signal, Matrix, Email, Home Assistant, and more — all from one gateway process |
| **Any LLM** | OpenAI format throughout; works with Nous Portal, OpenRouter (200+ models), Anthropic, OpenAI, z.ai, Kimi, MiniMax, any custom endpoint |
| **Run anywhere** | Six terminal backends: local, Docker, SSH, Daytona, Singularity, Modal (serverless) |
| **Research-ready** | Batch trajectory generation, Atropos RL environments, trajectory compression |
| **Scheduled** | Built-in cron scheduler with delivery to any platform |
| **Delegates** | Spawn isolated subagents for parallel workstreams; Python scripts can call tools via RPC |

**Tech stack:** Python 3.11+, OpenAI SDK (used for all providers), Rich + prompt_toolkit (TUI), SQLite/FTS5 (sessions), asyncio (gateway), multiprocessing (batch runner).

---

## 2. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Entry Points                                   │
│                                                                             │
│   hermes (cli.py)          hermes gateway (gateway/run.py)                  │
│   HermesCLI                GatewayRunner                                    │
│       │                          │                                          │
│       └──────────┬───────────────┘                                          │
│                  ▼                                                           │
│              AIAgent (run_agent.py)                                          │
│              run_conversation()                                              │
│                  │                                                           │
│         ┌────────┴────────┐                                                  │
│         ▼                 ▼                                                  │
│    model_tools.py    agent/ internals                                        │
│    handle_function_call()  prompt_builder.py                                 │
│         │            context_compressor.py                                   │
│         ▼            memory_manager.py                                       │
│    tools/registry.py                                                         │
│    (central dispatch)                                                        │
│         │                                                                    │
│    tools/*.py  (50 files, self-register at import)                           │
└─────────────────────────────────────────────────────────────────────────────┘

File Dependency Chain (import order matters):
  tools/registry.py          ← no deps, imported by all tool files
        ↑
  tools/*.py                 ← each calls registry.register() at import time
        ↑
  model_tools.py             ← imports tools/registry + triggers tool discovery
        ↑
  run_agent.py, cli.py, batch_runner.py, environments/
```

### Directory Map

```
hermes-agent/
├── run_agent.py              # AIAgent class — core conversation loop
├── model_tools.py            # Tool orchestration, _discover_tools(), handle_function_call()
├── toolsets.py               # Toolset definitions, _HERMES_CORE_TOOLS list
├── cli.py                    # HermesCLI class — interactive CLI orchestrator
├── hermes_state.py           # SessionDB — SQLite session store (FTS5 search)
├── hermes_constants.py       # get_hermes_home(), display_hermes_home(), provider URLs
├── hermes_logging.py         # Logging setup
├── hermes_time.py            # Timezone helpers
├── utils.py                  # Shared utilities
├── agent/                    # Agent internals
│   ├── prompt_builder.py         # System prompt assembly
│   ├── context_compressor.py     # Auto context compression
│   ├── prompt_caching.py         # Anthropic prompt caching
│   ├── auxiliary_client.py       # Auxiliary LLM client (vision, summarization)
│   ├── model_metadata.py         # Model context lengths, token estimation
│   ├── models_dev.py             # models.dev registry integration
│   ├── display.py                # KawaiiSpinner, tool preview formatting
│   ├── skill_commands.py         # Skill slash commands (shared CLI/gateway)
│   ├── trajectory.py             # Trajectory saving helpers
│   ├── memory_manager.py         # MemoryManager — multi-provider memory orchestration
│   ├── memory_provider.py        # MemoryProvider abstract base class
│   └── builtin_memory_provider.py  # Built-in memory implementation
├── hermes_cli/               # CLI subcommands and setup
│   ├── main.py                   # Entry point — all `hermes` subcommands
│   ├── config.py                 # DEFAULT_CONFIG, OPTIONAL_ENV_VARS, migration
│   ├── commands.py               # COMMAND_REGISTRY, SlashCommandCompleter
│   ├── callbacks.py              # Terminal callbacks (clarify, sudo, approval)
│   ├── setup.py                  # Interactive setup wizard
│   ├── skin_engine.py            # Skin/theme engine
│   ├── skills_config.py          # `hermes skills` — enable/disable per platform
│   ├── tools_config.py           # `hermes tools` — enable/disable per platform
│   ├── skills_hub.py             # `/skills` slash command (search, browse, install)
│   ├── models.py                 # Model catalog, provider model lists
│   ├── model_switch.py           # Shared /model switch pipeline (CLI + gateway)
│   └── auth.py                   # Provider credential resolution
├── tools/                    # Tool implementations (one file per tool)
│   ├── registry.py               # Central tool registry (schemas, handlers, dispatch)
│   ├── approval.py               # Dangerous command detection
│   ├── terminal_tool.py          # Terminal orchestration
│   ├── process_registry.py       # Background process management
│   ├── file_tools.py             # File read/write/search/patch
│   ├── web_tools.py              # Web search/extract (Parallel + Firecrawl + Exa)
│   ├── browser_tool.py           # Browser automation
│   ├── code_execution_tool.py    # execute_code sandbox
│   ├── delegate_tool.py          # Subagent delegation
│   ├── mcp_tool.py               # MCP client (~1050 lines)
│   ├── memory_tool.py            # MemoryStore (builtin memory backend)
│   ├── vision_tools.py           # Image analysis
│   ├── tts_tool.py               # Text-to-speech
│   ├── send_message_tool.py      # Cross-platform messaging from agent
│   ├── cronjob_tools.py          # Cron management tool
│   └── environments/             # Terminal backends
│       ├── base.py               # BaseEnvironment ABC
│       ├── local.py              # Local shell execution
│       ├── docker.py             # Docker containers
│       ├── ssh.py                # SSH remote
│       ├── modal.py              # Modal cloud sandboxes
│       ├── daytona.py            # Daytona backend
│       ├── singularity.py        # Singularity containers
│       └── persistent_shell.py   # Mixin for stateful shells
├── gateway/                  # Messaging platform gateway
│   ├── run.py                    # Main loop, slash commands, message dispatch
│   ├── session.py                # SessionStore, SessionEntry, SessionSource
│   └── platforms/                # Adapters (15 platforms)
│       ├── telegram.py, discord.py, slack.py, whatsapp.py
│       ├── signal.py, matrix.py, mattermost.py, email.py
│       ├── sms.py, dingtalk.py, feishu.py, wecom.py
│       ├── homeassistant.py, api_server.py, webhook.py
├── acp_adapter/              # ACP server (VS Code / Zed / JetBrains)
├── cron/                     # Scheduler
│   ├── scheduler.py              # tick(), delivery resolution
│   └── jobs.py                   # Job CRUD, storage, schedule parsing
├── skills/                   # Built-in bundled skills (~75 SKILL.md files)
├── optional-skills/          # Community optional skills
├── environments/             # RL training environments (Atropos)
│   ├── hermes_base_env.py        # HermesAgentBaseEnv
│   ├── agent_loop.py             # HermesAgentLoop, AgentResult
│   └── tool_context.py           # ToolContext for reward functions
├── tests/                    # Pytest suite (~3000 tests)
├── batch_runner.py           # Parallel batch trajectory generation
└── pyproject.toml            # Package definition, optional extras
```

---

## 3. Core Components

### 3.1 AIAgent — Core Conversation Loop

**File:** `run_agent.py`

The central class wrapping the LLM conversation loop. Entirely synchronous.

```python
class AIAgent:
    def __init__(
        self,
        base_url: str = None,
        api_key: str = None,
        provider: str = None,         # "anthropic", "openai", "openrouter", ...
        api_mode: str = None,         # "native" | "openai"
        model: str = "",              # e.g. "anthropic/claude-opus-4.6"
        max_iterations: int = 90,
        tool_delay: float = 1.0,
        enabled_toolsets: List[str] = None,
        disabled_toolsets: List[str] = None,
        save_trajectories: bool = False,
        verbose_logging: bool = False,
        quiet_mode: bool = False,
        ephemeral_system_prompt: str = None,
        session_id: str = None,
        platform: str = None,          # "cli", "telegram", "discord", ...
        skip_context_files: bool = False,
        skip_memory: bool = False,
        # Callbacks
        tool_progress_callback: callable = None,
        tool_start_callback: callable = None,
        tool_complete_callback: callable = None,
        thinking_callback: callable = None,
        reasoning_callback: callable = None,
        clarify_callback: callable = None,
        sudo_callback: callable = None,
        approval_callback: callable = None,
    )
```

**Key methods:**

| Method | Description |
|---|---|
| `chat(message: str) -> str` | Simple single-turn interface; returns final response string |
| `run_conversation(user_message, system_message=None, conversation_history=None, task_id=None) -> dict` | Full interface; returns `{final_response, messages, ...}` |
| `_build_system_prompt(system_message) -> str` | Assembles system prompt from skills, memory, context files |
| `toolsets_to_use() -> list` | Resolves enabled/disabled toolset list |

**Agent loop (inside `run_conversation`):**

```
while api_call_count < max_iterations and iteration_budget.remaining > 0:
    response = client.chat.completions.create(
        model=model, messages=messages, tools=tool_schemas
    )
    if response.tool_calls:
        for tool_call in response.tool_calls:
            result = handle_function_call(tool_call.name, tool_call.args, task_id)
            messages.append(tool_result_message(result))
        api_call_count += 1
    else:
        return response.content   # Final text response
```

Messages follow **OpenAI format**: `{"role": "system|user|assistant|tool", ...}`. Extended with `"reasoning"` field for thinking content.

**Context compression** is handled by `agent/context_compressor.py` — triggers automatically when approaching model context limit, transparently summarizes older messages.

**Prompt caching** (`agent/prompt_caching.py`) applies Anthropic cache-control breakpoints. Toolsets and system prompts must NOT change mid-conversation to preserve cache validity.

---

### 3.2 HermesCLI — Interactive Terminal UI

**File:** `cli.py`

```python
class HermesCLI:
    def __init__(self)       # Loads config, initializes skin, sets up prompt_toolkit session
    def run(self)            # Main REPL loop
    def process_command(command: str, cmd_original: str)  # Dispatches slash commands
```

**UI stack:**
- **Rich** — banner panel, response rendering, progress displays
- **prompt_toolkit** — multiline input with autocomplete, history, keybindings
- **KawaiiSpinner** (`agent/display.py`) — animated faces during API calls; `┊` activity feed for streaming tool results
- **Skin engine** (`hermes_cli/skin_engine.py`) — runtime theming

**Config loading:** `load_cli_config()` in `cli.py` merges hardcoded defaults + user `~/.hermes/config.yaml`.

**Working directory:** CLI uses `os.getcwd()` (current dir); Gateway uses `MESSAGING_CWD` env var (defaults to home).

---

### 3.3 Messaging Gateway

**Files:** `gateway/run.py`, `gateway/session.py`, `gateway/platforms/`

The gateway is an **async runner** managing multiple platform adapters simultaneously.

#### Session Management (`gateway/session.py`)

```python
@dataclass
class SessionSource:
    platform: Platform
    chat_id: str
    user_id: str
    thread_id: Optional[str] = None
    chat_topic: Optional[str] = None

@dataclass
class SessionContext:
    source: SessionSource
    connected_platforms: list
    home_channels: list
    session_key: str
    session_id: str
    timestamps: dict           # created_at, last_active_at

@dataclass
class SessionEntry:
    session_id: str
    session_key: str
    agent: AIAgent
    history: list              # OpenAI-format messages
    # Token tracking:
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int
    total_tokens: int
    estimated_cost_usd: float
    cost_status: str
```

Key functions:
- `build_session_key(source, group_sessions_per_user, thread_sessions_per_user) -> str` — deterministic session key
- `build_session_context_prompt(context, redact_pii=False) -> str` — injects platform context into system prompt

#### Platform Adapter Interface

All platform adapters extend `BasePlatformAdapter`:

```python
class BasePlatformAdapter:
    # Abstract — must implement:
    async def connect(self) -> bool
    async def disconnect(self)
    async def send(self, chat_id, content, reply_to=None, metadata=None) -> SendResult

    # Optional:
    async def edit_message(self, chat_id, message_id, content) -> SendResult
    async def send_typing(self, chat_id, metadata=None)
```

#### Message Event Model

```python
class MessageType(Enum):
    TEXT, LOCATION, PHOTO, VIDEO, AUDIO, VOICE, DOCUMENT, STICKER, COMMAND

@dataclass
class MessageEvent:
    text: str
    message_type: MessageType
    source: SessionSource
    raw_message: Any
    message_id: Optional[str]
    media_urls: list
    media_types: list
    reply_to_message_id: Optional[str]
    reply_to_text: Optional[str]
    auto_skill: Optional[str]   # Skill to invoke automatically
    timestamp: datetime

    def is_command(self) -> bool
    def get_command(self) -> Optional[str]   # "/reset" → "reset"
    def get_command_args(self) -> str

@dataclass
class SendResult:
    success: bool
    message_id: Optional[str]
    error: Optional[str]
    raw_response: Any
    retryable: bool
```

#### Platform Config

```python
class Platform(Enum):
    LOCAL, TELEGRAM, DISCORD, WHATSAPP, SLACK, SIGNAL
    MATTERMOST, MATRIX, HOMEASSISTANT, EMAIL, SMS
    DINGTALK, API_SERVER, WEBHOOK, FEISHU, WECOM

@dataclass
class PlatformConfig:
    enabled: bool
    token: Optional[str]
    api_key: Optional[str]
    home_channel: Optional[str]
    reply_to_mode: str           # "off" | "first" | "all"
    extra: dict                  # Platform-specific settings

@dataclass
class SessionResetPolicy:
    mode: str                    # "daily" | "idle" | "both" | "none"
    at_hour: int                 # 0-23
    idle_minutes: int            # default 1440
    notify: bool
    notify_exclude_platforms: tuple
```

---

### 3.4 Tool System & Registry

**File:** `tools/registry.py`

The registry is the central hub for all tool definitions and dispatch. Tools self-register at import time.

```python
# Registration
registry.register(
    name="example_tool",
    toolset="example",
    schema={
        "name": "example_tool",
        "description": "...",
        "parameters": {
            "type": "object",
            "properties": { "param": {"type": "string"} },
            "required": ["param"]
        }
    },
    handler=lambda args, **kw: example_tool(
        param=args.get("param", ""),
        task_id=kw.get("task_id")
    ),
    check_fn=check_requirements,       # Optional: returns bool
    requires_env=["EXAMPLE_API_KEY"],  # Optional: env vars to show in setup
)

# Dispatch
result = registry.dispatch(tool_name, args_dict, task_id=task_id)
# Returns JSON string always

# Schema collection
schemas = registry.get_schemas(toolset_filter=["web", "file"])
```

**Key constraints:**
- All handlers **must return a JSON string**
- `check_fn` is called at schema-collection time to gate availability
- Tool schemas are generated at **import time** (after profile override is applied)
- Agent-level tools (`todo`, `memory`) are intercepted by `run_agent.py` before `handle_function_call()`
- Cross-tool references in schema descriptions must be added dynamically in `get_tool_definitions()` in `model_tools.py`, not hardcoded

---

### 3.5 Toolsets

**File:** `toolsets.py`

Toolsets are semantic groups of tools that users enable/disable. The `_HERMES_CORE_TOOLS` list defines what's active on all platforms by default.

**Built-in toolsets:**

| Toolset | Tools |
|---|---|
| `web` | web_search, web_extract |
| `search` | web_search |
| `file` | read_file, write_file, patch, search_files |
| `terminal` | terminal, process |
| `browser` | browser_navigate, browser_snapshot, browser_click, browser_type, browser_scroll, browser_back, browser_press, browser_close, browser_get_images, browser_vision, browser_console, web_search |
| `vision` | vision_analyze |
| `image_gen` | image_generate |
| `moa` | mixture_of_agents |
| `skills` | skills_list, skill_view, skill_manage |
| `tts` | text_to_speech |
| `todo` | todo |
| `memory` | memory |
| `session_search` | session_search |
| `clarify` | clarify |
| `code_execution` | execute_code |
| `delegation` | delegate_task |
| `messaging` | send_message |
| `cronjob` | cronjob |
| `rl` | rl_list_environments, rl_select_environment, rl_get_current_config, rl_edit_config, rl_start_training, rl_check_status, rl_stop_training, rl_get_results, rl_list_runs, rl_test_inference |

Toolsets compose via `includes` — a toolset can reference other toolsets.

---

### 3.6 Slash Command Registry

**File:** `hermes_cli/commands.py`

All slash commands are defined in a single `COMMAND_REGISTRY` list of `CommandDef` objects. Every consumer derives from this automatically: CLI dispatch, gateway routing, Telegram BotCommand menus, Slack subcommand map, autocomplete completions, and help text.

```python
@dataclass
class CommandDef:
    name: str                    # Canonical name (no slash), e.g. "model"
    description: str
    category: str                # "Session" | "Configuration" | "Tools & Skills" | "Info" | "Exit"
    aliases: tuple = ()          # e.g. ("m",)
    args_hint: str = ""          # e.g. "[provider:model]"
    cli_only: bool = False
    gateway_only: bool = False
    gateway_config_gate: str = ""  # Config dotpath — makes cli_only available in gateway if truthy
```

**Key functions:**
- `resolve_command(input: str) -> Optional[str]` — maps input (including aliases) to canonical name
- `COMMANDS: dict` — flat `{name: CommandDef}` dict for autocomplete
- `COMMANDS_BY_CATEGORY: dict` — grouped for help display
- `GATEWAY_KNOWN_COMMANDS: frozenset` — for hook emission in gateway
- `telegram_bot_commands() -> list` — generates Telegram BotCommand objects
- `slack_subcommand_map() -> dict` — generates Slack routing
- `gateway_help_lines() -> list` — generates `/help` output

---

### 3.7 Session Storage

**File:** `hermes_state.py`

Persistent SQLite database at `~/.hermes/sessions.db` (WAL mode for concurrent access).

```python
class SessionDB:
    def __init__(self, db_path: Path)
    def save_session(self, session_id: str, messages: list, metadata: dict)
    def load_session(self, session_id: str) -> Optional[dict]
    def search_sessions(self, query: str, limit: int = 10) -> list  # FTS5 full-text search
    def list_sessions(self, limit: int = 50) -> list
    def delete_session(self, session_id: str)
    def get_session_summary(self, session_id: str) -> Optional[str]  # LLM-generated
```

**FTS5 search** enables the `session_search` tool — the agent can query its own conversation history across all past sessions with LLM summarization for recall.

---

### 3.8 Memory System

**Files:** `agent/memory_manager.py`, `agent/memory_provider.py`, `agent/builtin_memory_provider.py`, `tools/memory_tool.py`

Multi-provider architecture. Memory is read before each turn (`prefetch`) and written after each turn (`sync`).

#### MemoryManager

```python
class MemoryManager:
    def add_provider(self, provider: MemoryProvider)   # Max 1 external + always builtin
    def build_system_prompt(self) -> str               # Combines all provider prompts
    def prefetch_all(self, query: str) -> str          # Recall before turn
    def sync_all(self, user_msg, asst_response)        # Write after turn
    def queue_prefetch_all(self, query)                # Background recall for next turn
    def sanitize_context(self, text: str) -> str
    def build_memory_context_block(self, raw: str) -> str
```

#### MemoryProvider (Abstract Base)

```python
class MemoryProvider(ABC):
    @property
    @abstractmethod
    def name(self) -> str

    @abstractmethod
    def is_available(self) -> bool

    @abstractmethod
    def initialize(self, session_id: str, **kwargs)
    # kwargs always include: hermes_home, platform
    # kwargs may include: agent_context ("primary"|"subagent"|"cron"|"flush"),
    #                     agent_identity, agent_workspace,
    #                     parent_session_id, user_id

    @abstractmethod
    def prefetch(self, query: str, session_id: str = "") -> str

    @abstractmethod
    def sync_turn(self, user_content, assistant_content, session_id: str = "")

    @abstractmethod
    def get_tool_schemas(self) -> List[Dict[str, Any]]

    @abstractmethod
    def handle_tool_call(self, tool_name: str, args: dict) -> str

    @abstractmethod
    def shutdown(self)

    # Optional hooks:
    def on_turn_start(self): ...
    def on_session_end(self): ...
    def on_pre_compress(self): ...
    def on_memory_write(self): ...
    def on_delegation(self): ...
```

**Built-in provider** (`BuiltinMemoryProvider`):
- Wraps `MemoryStore` from `tools/memory_tool.py`
- Stores: `MEMORY.md` (general notes) and `USER.md` (user profile) in `~/.hermes/`
- `memory` tool is intercepted at `run_agent.py` level before `handle_function_call()`

**External providers:** Honcho dialectic user modeling (via `optional-skills/autonomous-ai-agents/honcho/`).

---

### 3.9 Skills System

**Files:** `agent/skill_commands.py`, `skills/` (bundled), `~/.hermes/skills/` (user), `optional-skills/` (community)

Skills are **procedural memory** — markdown documents with instructions, references, and scripts that the agent loads into context on demand.

#### Skill Discovery

```python
scan_skill_commands() -> Dict[str, Dict[str, Any]]
# Returns: {"/skill-name": {name, description, skill_md_path, skill_dir}}
# Scans: ~/.hermes/skills/, bundled skills/, HERMES_OPTIONAL_SKILLS dir

resolve_skill_command_key(command: str) -> Optional[str]
# Hyphens and underscores are interchangeable

build_skill_invocation_message(cmd_key, user_instruction="", task_id=None) -> Optional[str]
# Formats skill as a user message (not system prompt — preserves prompt caching)

build_preloaded_skills_prompt(skill_identifiers: list) -> tuple[str, list, list]
# Returns: (prompt_text, loaded_names, missing_names)
```

#### Skill YAML Frontmatter

```yaml
name: skill-name
description: One-line description
version: 1.0.0
author: Author Name
license: MIT
prerequisites:
  env_vars: [LIST_OF_REQUIRED_ENV_VARS]
  commands: [LIST_OF_REQUIRED_COMMANDS]
metadata:
  hermes:
    tags: [category, tags]
```

Skills invoke as **user messages**, not system prompt injection, to preserve Anthropic prompt caching validity.

**Bundled skill categories:** domain, productivity, note-taking, smart-home, gifs, devops, creative, dogfood, google-workspace, notion, linear, ocr-and-documents, obsidian, powerpoint, nano-pdf, openhue, webhook-subscriptions (~75 total SKILL.md files).

---

### 3.10 Cron Scheduler

**Files:** `cron/scheduler.py`, `cron/jobs.py`

File-based job store at `~/.hermes/cron/jobs.json`. Outputs at `~/.hermes/cron/output/{job_id}/{timestamp}.md`. The gateway calls `tick()` every 60 seconds.

#### Schedule Formats

```python
parse_schedule(schedule: str) -> dict
# Supports:
#   "30m", "2h", "1d"          → {kind: "interval", minutes: int, display: str}
#   "0 9 * * 1"  (cron expr)   → {kind: "cron", expr: str}
#   ISO datetime               → {kind: "once"}

parse_duration(s: str) -> int   # "30m" → 30, "2h" → 120, "1d" → 1440
```

#### Job Model Fields

| Field | Description |
|---|---|
| `id` | UUID |
| `schedule` | Schedule string |
| `skills` | List of skill names to run |
| `prompt` | Task prompt for the agent |
| `deliver` | Delivery target: `"local"` \| `"origin"` \| `"platform:chat_id"` |
| `enabled` | bool |
| `created_at` / `last_run_at` / `next_run_at` | ISO timestamps |

**Delivery resolution:** `_resolve_delivery_target(job)` maps deliver targets to concrete `{platform, chat_id, thread_id}`. Falls back to home channels from env vars. Supports 14 platforms: telegram, discord, slack, whatsapp, signal, matrix, mattermost, homeassistant, dingtalk, feishu, wecom, sms, email, webhook.

**File locking:** `~/.hermes/cron/.tick.lock` via Unix `fcntl` / Windows `msvcrt` — safe for multi-process access.

---

### 3.11 Terminal Backends

**Files:** `tools/environments/`

The `TERMINAL_ENV` environment variable selects the backend (default: `local`).

| Backend | Env value | Description |
|---|---|---|
| **Local** | `local` | Direct subprocess with persistent shell via mixin |
| **Docker** | `docker` | Isolated containers; cap-drop ALL, no-new-privileges, PID limits, resource quotas |
| **SSH** | `ssh` | Remote host via ControlMaster; interruptible foreground processes |
| **Modal** | `modal` | Serverless cloud sandboxes; snapshot persistence in `~/.hermes/modal_snapshots.json` |
| **Daytona** | `daytona` | Daytona cloud workspaces |
| **Singularity** | `singularity` | HPC Singularity containers |

**Base class:** `BaseEnvironment` in `tools/environments/base.py`.

**PersistentShellMixin** (`persistent_shell.py`) — maintains shell state across `execute()` calls (cwd, env vars, etc.).

**Local backend details:**
- Unique fence marker: `__HERMES_FENCE_a9f7b3__` for stdout/stderr separation
- Provider env var blocklist auto-derived from provider registry (prevents leaking API keys to subprocesses)
- Disk usage warning threshold: `DISK_USAGE_WARNING_THRESHOLD_GB` (default 500 GB)

**Docker backend details:**
- Security: `--cap-drop ALL --security-opt no-new-privileges --pids-limit N`
- Configurable: CPU, memory, disk resource limits; bind mounts for persistence

---

### 3.12 MCP Integration

**File:** `tools/mcp_tool.py` (~1050 lines)

Connects Hermes to any MCP (Model Context Protocol) server. Runs in a **dedicated background event loop** (`_mcp_loop`, daemon thread) for thread safety. Supports Python 3.13+ free-threading via `_lock`.

#### Configuration (in `~/.hermes/config.yaml`)

```yaml
mcp_servers:
  my-server:
    command: "npx"          # stdio transport
    args: ["-y", "@my/mcp-server"]
    env:
      MY_VAR: "value"
    timeout: 120            # seconds per call (default)
    connect_timeout: 60

  my-http-server:
    url: "https://mcp.example.com"   # HTTP/StreamableHTTP transport
    timeout: 120

    sampling:
      enabled: true
      model: "openrouter/google/gemini-flash-1.5"
      max_tokens_cap: 4096
      timeout: 30
      max_rpm: 60
      allowed_models: []    # empty = allow all
      max_tool_rounds: 5
      log_level: "info"     # "info" | "debug"
```

**Transport types:** stdio (`command` + `args`) or HTTP/StreamableHTTP (`url`).

**Sampling support:** MCP servers can request LLM completions via `sampling/createMessage`. Hermes acts as the sampling server.

**Reconnection:** Exponential backoff up to 5 retries per server.

---

### 3.13 ACP Adapter

**Files:** `acp_adapter/`

Implements the Agent-Client Protocol for IDE integrations (VS Code, Zed, JetBrains).

```python
class HermesACPAgent(acp.Agent):
    # Wraps AIAgent with ACP interface
    # Thread pool: ThreadPoolExecutor(max_workers=4)
    # Supports: text, image, audio, resource content blocks
```

Supporting modules:
- `acp_adapter/auth.py` — `detect_provider()`, `has_provider()`
- `acp_adapter/events.py` — `make_message_cb()`, `make_step_cb()`, `make_thinking_cb()`, `make_tool_progress_cb()`
- `acp_adapter/permissions.py` — `make_approval_callback()`
- `acp_adapter/session.py` — `SessionManager`, `SessionState`

---

### 3.14 Skin/Theme Engine

**File:** `hermes_cli/skin_engine.py`

Skins are **pure data** — no code changes required to add a new theme.

```python
@dataclass
class SkinConfig:
    name: str
    description: str
    colors: dict              # banner_border, banner_title, banner_accent, banner_dim,
                              # banner_text, response_border (Rich color strings)
    spinner: dict             # waiting_faces, thinking_faces, thinking_verbs, wings
    branding: dict            # agent_name, welcome, response_label, prompt_symbol
    tool_prefix: str          # Default "┊"
    tool_emojis: dict         # {tool_name: emoji}
```

**Key functions:**
- `init_skin_from_config()` — called at CLI startup, reads `display.skin` config key
- `get_active_skin() -> SkinConfig` — returns cached active skin
- `set_active_skin(name: str)` — switches at runtime (used by `/skin`)
- `load_skin(name: str) -> SkinConfig` — user skins first, then built-ins, then default

**Built-in skins:** `default` (gold/kawaii), `ares` (crimson/bronze), `mono` (grayscale), `slate` (blue dev).

**User skins:** Drop a YAML file in `~/.hermes/skins/<name>.yaml`. Missing values inherit from `default`.

---

## 4. Data Structures & Models

### Message Format (OpenAI-compatible)

```python
# User message
{"role": "user", "content": "Hello"}

# Assistant message
{"role": "assistant", "content": "Hi!", "tool_calls": [...], "reasoning": "..."}

# Tool result
{"role": "tool", "tool_call_id": "...", "content": "JSON string result"}

# System message
{"role": "system", "content": "You are..."}
```

### Tool Schema Format

```python
{
    "name": "tool_name",
    "description": "What this tool does",
    "parameters": {
        "type": "object",
        "properties": {
            "param1": {"type": "string", "description": "..."},
            "param2": {"type": "integer", "description": "..."},
        },
        "required": ["param1"]
    }
}
```

### Config YAML Structure

```yaml
# ~/.hermes/config.yaml

model: "openrouter/google/gemini-2.5-pro"    # Active model
provider: "openrouter"                         # Provider name

display:
  skin: "default"                              # Active skin
  tool_progress_command: false                 # Show tool progress in gateway
  background_process_notifications: "all"      # all | result | error | off

terminal:
  backend: "local"                             # local | docker | ssh | modal | daytona | singularity
  timeout: 120
  docker_image: "ubuntu:22.04"
  ssh_host: "user@host"
  ssh_key: "/path/to/key"

memory:
  provider: "builtin"                          # builtin | honcho | hybrid

session_reset:
  mode: "idle"                                 # daily | idle | both | none
  idle_minutes: 1440
  at_hour: 3
  notify: true

mcp_servers:
  server-name:
    command: "npx"
    args: ["-y", "@org/mcp-server"]
    timeout: 120
    sampling:
      enabled: false

toolsets:
  enabled: ["web", "file", "terminal"]        # Whitelist (overrides defaults)
  disabled: ["browser"]                        # Blacklist
```

### Batch Runner Data Schema

**Input:** JSONL with `{from: "human", value: "task description"}` pairs.

**Output trajectory:**
```python
{
    "messages": list,           # Full conversation history
    "tool_stats": {             # Per-tool usage counts
        "tool_name": {"count": int, "success": int, "failure": int}
    },
    "tool_error_counts": dict,
    "metadata": dict
}
```

---

## 5. Data Flow

### CLI Conversation Turn

```
User input (prompt_toolkit)
    │
    ▼
HermesCLI.process_input()
    │ (if slash command)
    ├──► process_command() → handler → output to terminal
    │
    │ (if user message)
    ▼
AIAgent.run_conversation(user_message)
    │
    ├──► MemoryManager.prefetch_all(query)       # Pre-turn memory recall
    ├──► prompt_builder.build_system_prompt()    # Skills + memory + context
    │
    ▼
LLM API call (OpenAI format)
    │
    ├── text response? ──────────────────────────► Display in Rich panel → Done
    │
    └── tool_calls?
            │
            ▼
        handle_function_call(name, args)
            │
            ├── agent-level tool (todo, memory)? → handle directly
            │
            └── registry.dispatch(name, args, task_id)
                    │
                    ▼
                tool handler → JSON string result
                    │
                    ▼
                tool_result message appended to history
                    │
                    ▼
                [back to LLM API call]
    │
    ▼
MemoryManager.sync_all(user_msg, response)   # Post-turn memory write
    │
    ▼
SessionDB.save_session()                      # Persist conversation
```

### Gateway Message Flow

```
Platform adapter receives message
    │
    ▼
MessageEvent created
    │
    ▼
gateway/run.py dispatch
    │
    ├── slash command? → process_command() → send reply
    │
    └── user message?
            │
            ▼
        SessionStore.get_or_create(session_key)
            │
            ▼
        AIAgent.run_conversation()  [same loop as CLI]
            │
            ▼
        StreamingResponse → platform adapter.send()
            │
            ▼
        Token usage tracked in SessionEntry
```

### Cron Execution Flow

```
Gateway tick() called every 60s
    │
    ▼
cron/scheduler.tick()
    │
    ├── acquire file lock (~/.hermes/cron/.tick.lock)
    ├── load jobs.json
    ├── find due jobs (by schedule expression or interval)
    │
    ▼
For each due job:
    ├── resolve delivery target
    ├── build AIAgent with job's skills preloaded
    ├── run_conversation(job.prompt)
    │
    ▼
Save output to ~/.hermes/cron/output/{job_id}/{timestamp}.md
    │
    ▼
Deliver result to platform (telegram, discord, etc.)
    │
    ▼
Update job.last_run_at, job.next_run_at in jobs.json
```

---

## 6. Configuration System

### Two Config Loaders

| Loader | Location | Used by |
|---|---|---|
| `load_cli_config()` | `cli.py` | Interactive CLI (`hermes`) |
| `load_config()` | `hermes_cli/config.py` | `hermes tools`, `hermes setup`, `hermes config` |
| Direct YAML load | `gateway/run.py` | Gateway process |

### Files

| File | Purpose |
|---|---|
| `~/.hermes/config.yaml` | All settings (model, toolsets, display, terminal, etc.) |
| `~/.hermes/.env` | API keys and secrets (loaded via python-dotenv) |
| `~/.hermes/MEMORY.md` | Agent's persistent general memory |
| `~/.hermes/USER.md` | User profile built by agent |
| `~/.hermes/skills/` | User-installed skills |
| `~/.hermes/skins/` | User-installed themes |
| `~/.hermes/sessions.db` | SQLite session history |
| `~/.hermes/cron/jobs.json` | Cron job definitions |
| `~/.hermes/cron/output/` | Cron execution logs |

### Profiles

Multiple fully isolated instances via `HERMES_HOME` environment variable:

```bash
hermes -p work         # Uses ~/.hermes/profiles/work/
hermes -p personal     # Uses ~/.hermes/profiles/personal/
HERMES_HOME=/custom/path hermes  # Fully custom path
```

`_apply_profile_override()` in `hermes_cli/main.py` sets `HERMES_HOME` before any module imports. All code must use `get_hermes_home()` from `hermes_constants` — never hardcode `~/.hermes`.

### Adding Config Options

```python
# hermes_cli/config.py
DEFAULT_CONFIG = {
    "my_feature": {
        "enabled": False,
        "timeout": 30,
    },
    # ...
}
# Bump _config_version (currently 5) to trigger migration for existing users
```

```python
# For .env variables:
OPTIONAL_ENV_VARS = {
    "MY_API_KEY": {
        "description": "API key for My Service",
        "prompt": "My Service API Key",
        "url": "https://example.com/api-keys",
        "password": True,
        "category": "tool",    # provider | tool | messaging | setting
    },
}
```

---

## 7. Key APIs & Interfaces

### Python API — Embedding AIAgent

```python
from run_agent import AIAgent

# Simple usage
agent = AIAgent(
    model="openrouter/google/gemini-2.5-pro",
    api_key="sk-...",
    enabled_toolsets=["web", "file", "terminal"],
)
response = agent.chat("Summarize the latest news on AI")

# Full usage with callbacks
def on_tool_start(tool_name, args):
    print(f"→ {tool_name}")

def on_tool_complete(tool_name, result):
    print(f"✓ {tool_name}")

agent = AIAgent(
    model="anthropic/claude-opus-4.6",
    platform="cli",
    session_id="my-session-123",
    max_iterations=50,
    tool_start_callback=on_tool_start,
    tool_complete_callback=on_tool_complete,
    enabled_toolsets=["web", "file"],
    disabled_toolsets=["browser"],
)
result = agent.run_conversation(
    user_message="Write a Python script that scrapes HN",
    system_message="You are a helpful Python expert",
)
# result = {
#   "final_response": str,
#   "messages": list,           # full message history
#   "tool_calls_made": int,
# }
```

### Tool Handler API

```python
# tools/my_tool.py
import json
from tools.registry import registry

def my_tool(param: str, task_id: str = None) -> str:
    result = {"output": f"Processed: {param}"}
    return json.dumps(result)

registry.register(
    name="my_tool",
    toolset="my_toolset",
    schema={
        "name": "my_tool",
        "description": "Does something useful",
        "parameters": {
            "type": "object",
            "properties": {
                "param": {"type": "string", "description": "Input parameter"}
            },
            "required": ["param"]
        }
    },
    handler=lambda args, **kw: my_tool(
        param=args.get("param", ""),
        task_id=kw.get("task_id")
    ),
    check_fn=lambda: bool(os.getenv("MY_API_KEY")),
    requires_env=["MY_API_KEY"],
)
```

### ToolContext API (for RL reward functions)

```python
from environments.tool_context import ToolContext

async def compute_reward(ctx: ToolContext, task: dict) -> float:
    # Terminal operations
    result = await ctx.terminal("python solution.py", timeout=30)

    # File operations
    content = await ctx.read_file("/workspace/output.txt")
    await ctx.write_file("/workspace/data.json", json_content)

    # Web operations
    results = await ctx.web_search("query")
    content = await ctx.web_extract("https://...")

    # Browser
    await ctx.browser_navigate("https://example.com")
    snapshot = await ctx.browser_snapshot()

    # Generic tool call
    result = await ctx.call_tool("vision_analyze", {"image_url": "..."})

    return 1.0 if "success" in result else 0.0
```

---

## 8. Tool Catalogue

### Core Tools (enabled by default)

| Tool | Toolset | Description |
|---|---|---|
| `web_search` | web | Search the web (Exa, Tavily, Parallel backends) |
| `web_extract` | web | Extract content from URLs (Firecrawl, Parallel) |
| `terminal` | terminal | Execute shell commands in configured backend |
| `process` | terminal | Manage background processes |
| `read_file` | file | Read files (respects `file_read_max_chars` limit) |
| `write_file` | file | Write/create files |
| `patch` | file | Apply fuzzy-matched file patches |
| `search_files` | file | Search file contents and file names |
| `vision_analyze` | vision | Analyze images via auxiliary LLM |
| `image_generate` | image_gen | Generate images (fal.ai) |
| `mixture_of_agents` | moa | Run MoA reasoning ensemble |
| `skills_list` | skills | List available skills |
| `skill_view` | skills | View skill contents |
| `skill_manage` | skills | Create/edit/delete skills |
| `browser_navigate` | browser | Navigate to URL |
| `browser_snapshot` | browser | Capture page DOM/screenshot |
| `browser_click` | browser | Click elements |
| `browser_type` | browser | Type into inputs |
| `browser_scroll` | browser | Scroll pages |
| `browser_back` | browser | Navigate back |
| `browser_press` | browser | Press keys |
| `browser_close` | browser | Close browser |
| `browser_get_images` | browser | Extract images from page |
| `browser_vision` | browser | Visual analysis of page |
| `browser_console` | browser | Access browser console |
| `text_to_speech` | tts | Convert text to audio (Edge TTS free, ElevenLabs, OpenAI) |
| `todo` | todo | Create and manage task lists (agent-level, intercepted pre-dispatch) |
| `memory` | memory | Read/write persistent memory (agent-level, intercepted pre-dispatch) |
| `session_search` | session_search | Full-text search past conversations (FTS5) |
| `clarify` | clarify | Ask the user clarifying questions (multiple choice or open-ended) |
| `execute_code` | code_execution | Run Python scripts that call tools via RPC |
| `delegate_task` | delegation | Spawn isolated subagents (max depth 2, max 3 concurrent) |
| `cronjob` | cronjob | Create/list/edit/pause/resume/remove scheduled tasks |
| `send_message` | messaging | Send messages to any connected platform (gated: gateway must be running) |
| `ha_*` | (core) | Home Assistant control (gated: `HASS_TOKEN` required) |

### RL Tools

| Tool | Description |
|---|---|
| `rl_list_environments` | List available Atropos environments |
| `rl_select_environment` | Select environment for training |
| `rl_get_current_config` | Get training config |
| `rl_edit_config` | Edit training config |
| `rl_start_training` | Start RL training run |
| `rl_check_status` | Check training status |
| `rl_stop_training` | Stop training |
| `rl_get_results` | Get training results |
| `rl_list_runs` | List all training runs |
| `rl_test_inference` | Test model inference |

---

## 9. Platform Support Matrix

| Platform | Type | Features |
|---|---|---|
| **CLI** | Local TUI | Full Rich TUI, autocomplete, history, multiline editing, streaming |
| **Telegram** | Messaging | Text, images, voice memos (STT), file uploads, BotCommand menu |
| **Discord** | Messaging | Text, embeds, slash commands registered natively |
| **Slack** | Messaging | `/hermes` slash command routing, app mentions |
| **WhatsApp** | Messaging | Text, media (via WA Business API or WPPConnect) |
| **Signal** | Messaging | Text, attachments (via signal-cli HTTP API) |
| **Matrix** | Messaging | Text, optional E2E encryption, threaded replies |
| **Mattermost** | Messaging | Text, webhooks |
| **Email** | Messaging | Send/receive via SMTP/IMAP |
| **SMS** | Messaging | Via Twilio |
| **DingTalk** | Messaging | Enterprise chat (dingtalk-stream) |
| **Feishu/Lark** | Messaging | Enterprise chat (lark-oapi) |
| **WeCom** | Messaging | WeChat Work |
| **Home Assistant** | IoT | Smart home entity/service control |
| **API Server** | HTTP | REST API for programmatic access |
| **Webhook** | HTTP | Outbound webhook delivery |
| **ACP** | IDE | VS Code, Zed, JetBrains via Agent-Client Protocol |

---

## 10. Research & RL Infrastructure

### Batch Runner (`batch_runner.py`)

Parallel trajectory generation from JSONL datasets:

```bash
python batch_runner.py \
    --dataset_file=data.jsonl \
    --batch_size=10 \
    --run_name=my_run \
    --distribution=image_gen   # Toolset distribution preset
    --resume                   # Resume interrupted run
```

- Uses `multiprocessing.Pool` for parallel batches
- Checkpointing for fault tolerance
- Rich progress bar (spinner, bar, ETA, completion count)
- Saves trajectories in Arrow/Parquet format (HuggingFace-compatible)

### RL Environments (`environments/`)

Built on the [Atropos](https://github.com/NousResearch/atropos) framework.

**Inheritance chain:**
```
BaseEnv (atroposlib)
    └── HermesAgentBaseEnv (environments/hermes_base_env.py)
            ├── TerminalTestEnv
            ├── HermesSweEnv
            └── TerminalBench2EvalEnv
```

**HermesAgentLoop** (`environments/agent_loop.py`):

```python
class HermesAgentLoop:
    """Reusable multi-turn engine for RL rollouts."""

    async def run(self, messages, tools, max_iterations) -> AgentResult

@dataclass
class AgentResult:
    conversation: list          # Full message history
    turn_count: int
    reasoning: list             # Per-turn reasoning text
    tool_errors: list
    managed_server_state: Any
```

**Two-phase operation:**
1. Phase 1: OpenAI API server for initial rollout
2. Phase 2: VLLM ManagedServer for policy model

**`ToolContext`** provides reward functions with sandboxed access to all Hermes tools scoped to a `task_id`.

### Trajectory Compression (`trajectory_compressor.py`)

Compresses conversation trajectories for training data — reduces token cost while preserving tool-calling patterns.

---

## 11. Usage Guide

### Installation

```bash
# Recommended (handles all dependencies)
curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
source ~/.bashrc

# From source (development)
uv venv venv --python 3.11 && source venv/bin/activate
uv pip install -e ".[all,dev]"
```

### First-Time Setup

```bash
hermes setup          # Interactive setup wizard (model, API keys, platform config)
hermes model          # Change active model
hermes tools          # Enable/disable toolsets
```

### CLI Usage

```bash
hermes                # Start interactive CLI
hermes -p work        # Start with "work" profile

# Inside CLI — slash commands:
/new                  # New conversation
/model [provider:model]  # Switch model
/personality [name]   # Set personality
/retry                # Retry last turn
/undo                 # Undo last turn
/compress             # Compress context
/usage                # Show token usage
/insights [--days N]  # Usage analytics
/skills               # Browse/install skills
/<skill-name>         # Invoke a skill
/skin [name]          # Switch theme
/background <prompt>  # Run task in background
/btw <info>           # Add context without triggering response
/stop                 # Stop current task
/help                 # Show all commands
```

### Gateway Usage

```bash
hermes gateway setup   # Configure messaging platforms
hermes gateway start   # Start gateway process

# Supported platforms configure via:
hermes gateway setup telegram
hermes gateway setup discord
hermes gateway setup slack
# etc.
```

### Profiles

```bash
hermes profile create work     # Create profile
hermes profile list            # List all profiles
hermes -p work                 # Use profile
hermes profile delete old      # Delete profile
```

### Cron Scheduling

```bash
# Via the agent (natural language):
# "Schedule a daily 9am report on Hacker News to Telegram"

# Via CLI:
hermes cron list
hermes cron add --schedule "0 9 * * *" --prompt "..." --deliver "telegram:CHAT_ID"
hermes cron pause JOB_ID
hermes cron resume JOB_ID
hermes cron remove JOB_ID
```

### MCP Servers

Add to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  filesystem:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
  my-http-server:
    url: "https://mcp.example.com/sse"
    timeout: 60
```

### Optional Extras (pip)

```bash
pip install "hermes-agent[messaging]"   # Telegram, Discord, Slack, WhatsApp
pip install "hermes-agent[voice]"       # Local STT via faster-whisper
pip install "hermes-agent[modal]"       # Modal cloud sandboxes
pip install "hermes-agent[mcp]"         # MCP client
pip install "hermes-agent[honcho]"      # Honcho memory provider
pip install "hermes-agent[rl]"          # Atropos RL environments
pip install "hermes-agent[all]"         # Everything except RL and matrix
```

---

## 12. Extension Guide

### Adding a Tool

**3 files required:**

**1. `tools/my_tool.py`:**
```python
import json, os
from tools.registry import registry
from hermes_constants import get_hermes_home

def my_tool(param: str, task_id: str = None) -> str:
    return json.dumps({"result": "..."})

registry.register(
    name="my_tool",
    toolset="my_toolset",
    schema={
        "name": "my_tool",
        "description": "...",
        "parameters": {
            "type": "object",
            "properties": {"param": {"type": "string"}},
            "required": ["param"]
        }
    },
    handler=lambda args, **kw: my_tool(args.get("param"), kw.get("task_id")),
    check_fn=lambda: bool(os.getenv("MY_API_KEY")),
    requires_env=["MY_API_KEY"],
)
```

**2. `model_tools.py`** — add import in `_discover_tools()` list.

**3. `toolsets.py`** — add to `_HERMES_CORE_TOOLS` or a named toolset entry.

**Rules:**
- Handlers must return a JSON string
- Use `get_hermes_home()` for any persistent state storage
- Use `display_hermes_home()` in user-facing schema descriptions for paths
- Don't hardcode cross-tool references in schema descriptions (use `get_tool_definitions()` in `model_tools.py`)

### Adding a Slash Command

**1. `hermes_cli/commands.py`** — add `CommandDef` to `COMMAND_REGISTRY`:
```python
CommandDef("mycommand", "Description", "Session",
           aliases=("mc",), args_hint="[arg]"),
```

**2. `cli.py`** — add handler in `HermesCLI.process_command()`:
```python
elif canonical == "mycommand":
    self._handle_mycommand(cmd_original)
```

**3. `gateway/run.py`** (if gateway-available):
```python
if canonical == "mycommand":
    return await self._handle_mycommand(event)
```

### Adding a Platform Adapter

See `gateway/platforms/ADDING_A_PLATFORM.md`. Implement `BasePlatformAdapter` and add to the `Platform` enum.

### Adding a Memory Provider

Implement `MemoryProvider` ABC from `agent/memory_provider.py`. Register in `MemoryManager` with `add_provider()`. The builtin provider is always loaded first; maximum one external provider.

### Adding a Built-in Skill

Drop a `SKILL.md` with YAML frontmatter in `skills/<category>/<skill-name>/SKILL.md`. Sills in `~/.hermes/skills/` override bundled skills with the same name.

### Adding a Skin

Add to `_BUILTIN_SKINS` in `hermes_cli/skin_engine.py`:
```python
"my-skin": {
    "name": "my-skin",
    "description": "My custom theme",
    "colors": {
        "banner_border": "#FF6B6B",
        "banner_title": "#FECA57",
        "response_border": "#48DBFB",
    },
    "spinner": {
        "thinking_verbs": ["thinking", "processing"],
        "waiting_faces": ["(ᵔ◡ᵔ)", "(◕ᗜ◕)"],
    },
    "branding": {
        "agent_name": "My Agent",
        "prompt_symbol": "❯",
    },
    "tool_prefix": "┊",
}
```

Or create `~/.hermes/skins/my-skin.yaml` — no code change required.
