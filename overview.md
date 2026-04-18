# Hermes Agent

> Self-improving AI agent framework by Nous Research — creates skills from experience, runs everywhere, and connects to 18+ messaging platforms.

**Current version:** 0.8.0 (released April 8, 2026)  
**Commit:** `14c7d3e84f1f4690f36784679bd75423ec3eedbd`

---

## Project Info

- **Language / Runtime:** Python 3.11+
- **Framework(s):** OpenAI-compatible chat.completions API (provider-agnostic), Rich + prompt_toolkit (TUI), asyncio (gateway)
- **Package manager:** `uv` (recommended) / pip
- **License:** MIT
- **Entry points:**
  - `hermes` — interactive CLI and all subcommands (`hermes_cli/main.py`)
  - `hermes gateway` — async messaging gateway (`gateway/run.py`)
  - `hermes-agent` — headless agent runner (`run_agent.py`)
  - `hermes-acp` — Agent Communication Protocol server (`acp_adapter/entry.py`)

### Key Dependencies

| Package | Purpose |
|---------|---------|
| `openai` | OpenAI-compatible chat.completions client (used for all providers) |
| `anthropic` | Native Anthropic Messages API client (prompt caching, thinking blocks) |
| `rich` | Terminal formatting, progress bars, streaming output |
| `prompt_toolkit` | Interactive TUI, keybindings, autocomplete |
| `pydantic` | Config validation, data models |
| `tenacity` | Retry logic with exponential backoff |
| `python-telegram-bot` | Telegram gateway adapter |
| `discord.py` | Discord gateway adapter |
| `slack-bolt` | Slack gateway adapter |
| `mautrix` | Matrix gateway adapter (with E2EE) |
| `exa-py` / `firecrawl-py` / `parallel-web` | Web search and extraction |
| `edge-tts` | Free text-to-speech (no API key required) |
| `faster-whisper` | Local speech-to-text |
| `mcp` | Model Context Protocol server support |
| `croniter` | Cron expression parsing for scheduled tasks |
| `PyJWT` | GitHub App JWT auth for Skills Hub |

---

## Architecture Overview

Hermes is a **monolithic agent framework** with a layered architecture. The same `AIAgent` core powers the interactive CLI, 18+ messaging gateway platforms, batch processing, and RL training environments. All layers speak the same OpenAI message format internally.

```
┌─────────────────────────────────────────────────────────────────┐
│  Entry Points                                                   │
│  cli.py (HermesCLI / TUI)    gateway/run.py    batch_runner.py  │
│  rl_cli.py                   acp_adapter/      environments/    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Core Agent Loop  (run_agent.py — AIAgent / run_conversation())  │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ Prompt      │  │ Context      │  │ Error Classifier       │  │
│  │ Builder     │  │ Compressor   │  │ + Retry / Failover     │  │
│  └─────────────┘  └──────────────┘  └────────────────────────┘  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ Credential  │  │ Rate Limit   │  │ Auxiliary Client       │  │
│  │ Pool        │  │ Tracker      │  │ (compression/vision)   │  │
│  └─────────────┘  └──────────────┘  └────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Tool Layer  (model_tools.py + tools/registry.py)               │
│                                                                 │
│  terminal  file  web  browser  vision  delegate  memory  mcp    │
│  code_exec  tts  send_message  todo  skills  cron  homeassistant │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│  Persistence                                                    │
│  SQLite (sessions/messages/FTS5)  ~/.hermes/  trajectory.jsonl  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

- **Synchronous agent core, async gateway:** `run_conversation()` is synchronous; the gateway runs async and dispatches agents via `run_in_executor`.
- **Provider-agnostic via OpenAI SDK:** All LLM providers (Anthropic, Gemini, xAI, Qwen, MiniMax, OpenRouter, Nous, local Ollama, vLLM, etc.) are accessed via `openai.OpenAI` with custom `base_url`. Anthropic native features (prompt caching, thinking blocks) use a separate `anthropic.Anthropic` client via `anthropic_adapter.py`.
- **Tool self-registration:** Every tool file calls `registry.register()` at import time. `model_tools.py` is the only file that imports all tool modules, triggering discovery.
- **No mid-conversation context mutation:** System prompt and toolsets are frozen per session to preserve Anthropic prefix caching. Only context compression is allowed to mutate the message list.
- **Skills as user messages:** Skill content is injected as user-role messages (not system prompt) to avoid breaking the cached system-prompt prefix.

---

## Directory Structure

```
hermes-agent/
├── cli.py                    # HermesCLI — interactive TUI (9,800+ LOC)
├── run_agent.py              # AIAgent — synchronous agent loop (10,500+ LOC)
├── model_tools.py            # Tool discovery, dispatch, get_tool_definitions()
├── toolsets.py               # Toolset groupings (_HERMES_CORE_TOOLS, platform sets)
├── toolset_distributions.py  # Weighted toolset sampling for RL training
├── hermes_constants.py       # get_hermes_home(), paths, provider URLs
├── hermes_state.py           # SQLite session/message store (schema v6, FTS5)
├── hermes_logging.py         # Centralized logging (RedactingFormatter, component loggers)
├── hermes_time.py            # Timezone-aware clock (HERMES_TIMEZONE / config.yaml)
├── utils.py                  # Shared utilities
│
├── agent/                    # Agent infrastructure
│   ├── anthropic_adapter.py  # Anthropic Messages API adapter (prompt caching, thinking)
│   ├── auxiliary_client.py   # Unified aux LLM resolver (vision, compression, extraction)
│   ├── context_compressor.py # Lossy summarization when context exceeds threshold
│   ├── context_engine.py     # Abstract base class for pluggable context strategies
│   ├── context_references.py # Cross-session reference resolution
│   ├── credential_pool.py    # Multi-key failover pool (round-robin / fill-first / random)
│   ├── display.py            # KawaiiSpinner, streaming display helpers
│   ├── error_classifier.py   # API error taxonomy → recovery recommendation
│   ├── manual_compression_feedback.py  # /compress <focus> guided compression
│   ├── memory_manager.py     # Memory read/write scheduling
│   ├── memory_provider.py    # MemoryProvider ABC
│   ├── model_metadata.py     # Context length detection, token estimation
│   ├── models_dev.py         # models.dev provider metadata
│   ├── prompt_builder.py     # System prompt assembly, injection detection
│   ├── rate_limit_tracker.py # x-ratelimit-* header parsing and display
│   ├── retry_utils.py        # Jittered exponential backoff
│   ├── skill_commands.py     # /skill and /plan command helpers
│   ├── skill_utils.py        # Skill SKILL.md frontmatter parsing
│   ├── smart_model_routing.py# Cheap-vs-strong routing for simple turns
│   ├── subdirectory_hints.py # Hermes.md discovery up git tree
│   └── usage_pricing.py      # Token cost estimation
│
├── tools/                    # Tool implementations (46 tools, self-registering)
│   ├── registry.py           # Central registry (no deps — imported by everything)
│   ├── approval.py           # Dangerous command detection, approval/deny flow
│   ├── terminal_tool.py      # terminal, process — local/Docker/SSH/Modal/Daytona
│   ├── file_tools.py         # read_file, write_file, patch, search_files
│   ├── web_tools.py          # web_search, web_extract
│   ├── browser_tool.py       # browser_* — Playwright + Camofox stealth browser
│   ├── vision_tools.py       # vision_analyze
│   ├── image_generation_tool.py  # image_generate (DALL-E, Flux, FAL)
│   ├── delegate_tool.py      # delegate_task — spawn isolated subagents
│   ├── code_execution_tool.py# execute_code — Python with full tool access
│   ├── memory_tool.py        # memory — durable notes + user profile
│   ├── todo_tool.py          # todo — task list management
│   ├── session_search_tool.py# session_search — FTS5 cross-session search
│   ├── mcp_tool.py           # MCP server tool proxy
│   ├── skill_manager_tool.py # skill_manage — create/edit/delete/publish skills
│   ├── skills_tool.py        # skills_list, skill_view
│   ├── send_message_tool.py  # send_message — cross-platform delivery
│   ├── tts_tool.py           # text_to_speech
│   ├── voice_mode.py         # Voice input/output integration
│   ├── clarify_tool.py       # clarify — ask user questions
│   ├── cronjob_tools.py      # cronjob — scheduled tasks
│   ├── homeassistant_tool.py # ha_* — Home Assistant integration
│   ├── mixture_of_agents_tool.py  # mixture_of_agents
│   ├── rl_training_tool.py   # rl_* — RL training management
│   └── [+ 20 more tool files]
│
├── hermes_cli/               # CLI subcommands and config
│   ├── main.py               # All `hermes <subcommand>` entry points (~30 subcommands)
│   ├── commands.py           # COMMAND_REGISTRY — central slash command definitions
│   ├── config.py             # DEFAULT_CONFIG, load_config(), config schema
│   ├── auth.py               # OAuth flows, credential management (15+ providers)
│   ├── auth_commands.py      # `hermes auth` subcommands
│   ├── backup.py             # `hermes backup` / `hermes import`
│   ├── skin_engine.py        # Skin/theme system (pure data, YAML-based)
│   ├── tools_config.py       # curses-based tool selection TUI
│   ├── claw.py               # OpenClaw migration utilities
│   ├── banner.py             # Startup banner
│   ├── clipboard.py          # Cross-platform clipboard support
│   └── [+ more files]
│
├── gateway/                  # Async messaging gateway
│   ├── run.py                # GatewayRunner, main async loop (~8,500 LOC)
│   ├── config.py             # Platform enum, PlatformConfig, HomeChannel
│   ├── session.py            # SessionSource, SessionResetPolicy, SessionStore
│   ├── session_context.py    # contextvars for async-safe session state
│   ├── stream_consumer.py    # Progressive message editing via stream deltas
│   ├── pairing.py            # Code-based DM authorization
│   ├── display_config.py     # Per-platform display verbosity config
│   └── platforms/
│       ├── base.py           # BasePlatformAdapter, MessageEvent, SendResult
│       ├── helpers.py        # MessageDeduplicator, TextBatchAggregator, ThreadParticipationTracker
│       ├── telegram.py       # Telegram (python-telegram-bot, long-poll or webhook)
│       ├── discord.py        # Discord (discord.py, native slash commands)
│       ├── slack.py          # Slack (slack-bolt, Socket Mode)
│       ├── matrix.py         # Matrix (mautrix, E2EE optional)
│       ├── weixin.py         # WeChat via Tencent iLink Bot API
│       ├── wecom.py          # WeCom AI Bot WebSocket
│       ├── wecom_callback.py # WeCom self-built app callback mode
│       ├── feishu.py         # Feishu/Lark (lark_oapi, interactive cards)
│       ├── dingtalk.py       # DingTalk (dingtalk-stream SDK)
│       ├── signal.py         # Signal (signal-cli HTTP daemon, SSE)
│       ├── bluebubbles.py    # BlueBubbles / iMessage (macOS local API)
│       ├── sms.py            # Twilio SMS
│       ├── email.py          # IMAP/SMTP email
│       ├── mattermost.py     # Mattermost REST API + WebSocket
│       ├── whatsapp.py       # WhatsApp (Node.js bridge)
│       ├── webhook.py        # Generic HMAC-signed webhook
│       └── api_server.py     # OpenAI-compatible REST + SSE API server
│
├── cron/
│   ├── scheduler.py          # tick() — evaluate and dispatch due jobs
│   └── jobs.py               # Job CRUD, cron expression parsing, output persistence
│
├── environments/             # RL training environments
│   ├── agent_loop.py         # HermesAgentLoop — reusable multi-turn eval engine
│   ├── hermes_base_env.py    # HermesAgentBaseEnv — Atropos abstract base
│   ├── web_research_env.py   # FRAMES benchmark web research environment
│   ├── agentic_opd_env.py    # On-Policy Distillation environment
│   └── benchmarks/           # terminalbench_2, yc_bench, tblite
│
├── plugins/
│   ├── memory/               # Memory provider plugins: byterover, hindsight,
│   │                         #   holographic, honcho, mem0, openviking, retaindb, supermemory
│   └── context_engine/       # Pluggable context management strategies
│
├── skills/                   # 78 built-in skills (SKILL.md + supporting files each)
├── optional-skills/          # 13 optional skills (blockchain, security, mlops, etc.)
│
├── acp_adapter/              # Agent Communication Protocol (VS Code/JetBrains/Zed)
│   ├── entry.py
│   ├── server.py
│   └── session.py
│
├── tests/                    # 521 test files (pytest + pytest-asyncio)
├── docs/                     # Architecture docs, platform guides, migration notes
├── website/                  # Docusaurus documentation site
├── scripts/                  # Setup and packaging scripts
├── packaging/                # Nix flake, Homebrew, AUR packaging
│
├── pyproject.toml            # Project metadata, optional extras, entry points
├── cli-config.yaml.example   # All config options with annotations
├── .env.example              # All environment variables with descriptions
├── Dockerfile                # Non-root containerization
└── AGENTS.md                 # Complete developer reference
```

---

## Data Structures & Models

### Message Format (OpenAI-compatible, internal wire format)

```python
# User or assistant turn
{
    "role": "user" | "assistant",
    "content": str
              | [{"type": "text", "text": "..."},
                 {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}],
    # assistant only:
    "tool_calls": [{"id": str, "type": "function",
                    "function": {"name": str, "arguments": str}}],  # arguments is JSON string
    "reasoning_content": str  # thinking blocks (Anthropic/xAI)
}

# Tool result
{
    "role": "tool",
    "tool_call_id": str,
    "name": str,    # tool name
    "content": str  # JSON string
}
```

### Session DB Schema (SQLite, `~/.hermes/state.db`, schema v6)

| Table | Key Fields |
|-------|-----------|
| `sessions` | id, source, user_id, model, system_prompt, parent_session_id, created_at, token_usage, billing |
| `messages` | id, session_id, role, content, tool_calls, reasoning, codex_reasoning_items, created_at |
| `messages_fts` | FTS5 virtual table over messages.content (enables `session_search`) |

### Tool Registry Entry

```python
registry.register(
    name="tool_name",
    description="...",
    parameters={...},          # JSON Schema object
    handler=async_fn,
    is_async=True,
    max_result_size_chars=50000,
    toolsets=["web"],           # toolset membership
    available_fn=lambda: bool   # optional runtime availability check
)
```

### PooledCredential (`agent/credential_pool.py`)

```python
provider, id, label, auth_type, priority
access_token, refresh_token, expires_at
base_url, inference_base_url
runtime_api_key, runtime_base_url       # computed properties
last_status, last_error_code, last_error_reset_at
```

Pool strategies: `fill_first`, `round_robin`, `random`, `least_used`.

### MessageEvent (gateway, normalized across all platforms)

```python
text: str
message_type: MessageType  # TEXT, PHOTO, AUDIO, VIDEO, DOCUMENT, VOICE, STICKER, COMMAND
source: SessionSource      # platform, chat_id, user_id, thread_id, chat_name, chat_type
media_urls: list[str]      # local cache paths
media_types: list[str]     # MIME types
reply_to_message_id: str | None
reply_to_text: str | None
auto_skill: str | None     # channel-bound skill binding
internal: bool             # bypass auth checks
timestamp: datetime
```

### ClassifiedError (`agent/error_classifier.py`)

```python
reason: FailoverReason     # auth, billing, rate_limit, overloaded, context_overflow, ...
retryable: bool
should_compress: bool
should_rotate_credential: bool
should_fallback: bool
status_code: int | None
provider: str
model: str
message: str
```

---

## Data Flow

### Interactive CLI Session

```
1.  User types prompt → HermesCLI.run_loop() (cli.py)
2.  Slash command check → COMMAND_REGISTRY dispatch (if /command)
3.  load_cli_config() → ~/.hermes/config.yaml or ./cli-config.yaml
4.  _ensure_runtime_credentials() → resolve provider, build client
5.  AIAgent.run_conversation() (run_agent.py)

    Within run_conversation():
6.  Sanitize input (surrogates, non-ASCII)
7.  build_system_prompt() → identity + memory + skills index + context files
    (frozen for session — preserves Anthropic prefix cache)

8.  ─── TOOL LOOP (up to max_turns = 90) ───────────────────────────────
    a. API call (OpenAI SDK or Anthropic SDK)
    b. Receive response: text tokens or tool_calls
    c. If tool_calls:
       - Coerce argument types to match JSON Schema
       - Classify parallelism safety (read-only: parallel / destructive: serial)
       - Dispatch via model_tools.handle_function_call()
         → tools/registry.py → tool handler → JSON result string
       - Append tool results to messages
    d. If text → stream to terminal via display callback
    e. Check token usage → compress if > threshold (context_compressor.py)
    f. On API error → error_classifier.py decides:
         retry with backoff | rotate credential | compress | fallback provider
    g. Repeat until text-only response or budget exhausted
    ────────────────────────────────────────────────────────────────────

9.  Save session → hermes_state.py (SQLite, WAL mode)
10. Display cost estimate, rate limit status
```

### Gateway Message Flow

```
Platform adapter (Telegram, Discord, Slack, etc.)
    ↓ native protocol event
Build normalized MessageEvent
    ↓
set_session_vars() → contextvars.ContextVar (per-asyncio-task, no cross-contamination)
    ↓
Load or create SessionStore entry (conversation history + memory)
    ↓
Apply session reset policy (daily boundary / idle timeout / both)
    ↓
Authorization check (allowlist / pairing code)
    ↓
run_in_executor(agent.run_conversation())   ← synchronous in thread pool
    ↓ stream deltas
GatewayStreamConsumer → progressive platform message edits
    ↓ final send
adapter.send() → platform REST API
    ↓
Save session
```

### Context Compression Flow

```
token_usage > threshold (default 50% of model context window)
    ↓
context_compressor.py:
    1. Prune large old tool results (fast pre-pass — replace with placeholder)
    2. Protect head (system prompt + first 3 exchanges)
    3. Protect tail (recent 20% of tokens — keeps latest work in full)
    4. LLM summarization of middle turns with structured template:
         [CONTEXT COMPACTION — REFERENCE ONLY]
         [Resolved] [Pending] [Remaining Work]
    5. Insert compaction marker into message list
    ↓
Compressed messages replace full history for next API call

/compress <focus>: user-guided variant — preserve specified topic
```

### Cron Scheduler Flow

```
~/.hermes/cron/jobs.json
    ↓ background thread ticks every 60s
cron/scheduler.py tick() — acquires file lock, evaluates croniter expressions
    ↓ for each due job
AIAgent.run_conversation() with job.prompt + job.skills
    ↓
Output saved → ~/.hermes/cron/output/{job_id}/{timestamp}.md
    ↓
Delivery routing:
    - "local"    → saved only
    - "origin"   → back to triggering platform/chat
    - "telegram" / "discord" / "slack" / "webhook" / ... → home channel or explicit target
```

---

## Main API / Interfaces

### Tool Registry (46 tools, 10 toolsets)

| Tool | Toolset | Description |
|------|---------|-------------|
| `terminal` | terminal | Execute shell commands (local, Docker, SSH, Modal, Singularity, Daytona) |
| `process` | terminal | List, kill, monitor background processes |
| `read_file` | file | Read file with offset/limit |
| `write_file` | file | Create or overwrite files |
| `patch` | file | Fuzzy string-replace patch |
| `search_files` | file | Regex content search + filename glob |
| `web_search` | web | Web search (Exa, Firecrawl, Parallel, Tavily) |
| `web_extract` | web | Extract/summarize URLs as Markdown |
| `browser_navigate` | browser | Navigate to URL in managed Playwright session |
| `browser_snapshot` | browser | Screenshot (viewport or full page) |
| `browser_click/type/scroll/press/back` | browser | Browser interaction primitives |
| `browser_vision` | browser | Multimodal page analysis (vision LLM) |
| `browser_console` | browser | Execute JavaScript in page context |
| `vision_analyze` | vision | Analyze images with multimodal LLM |
| `image_generate` | image_gen | Generate images (DALL-E 3, Flux, FAL.ai) |
| `execute_code` | code_execution | Run Python with full tool access |
| `delegate_task` | delegation | Spawn isolated subagent with own budget |
| `memory` | memory | Read/write persistent notes and user profile |
| `todo` | todo | Task list (create, update, list, complete) |
| `session_search` | session_search | Full-text search across past sessions (FTS5) |
| `clarify` | clarify | Ask user a question (multiple-choice or open) |
| `skills_list` / `skill_view` | skills | Browse and inspect available skills |
| `skill_manage` | skills | Create, edit, delete, publish skills |
| `text_to_speech` | tts | TTS (Edge, ElevenLabs, OpenAI, MiniMax, Voxtral) |
| `send_message` | messaging | Send to Telegram/Discord/Slack/SMS/Email/Signal |
| `cronjob` | cronjob | Create, list, edit, pause, resume scheduled tasks |
| `mixture_of_agents` | moa | Multi-agent reasoning panel |
| `ha_list_entities` / `ha_get_state` / `ha_call_service` / `ha_list_services` | homeassistant | Home Assistant control |
| `rl_*` (10 tools) | rl | RL training management (environments, config, runs) |

### CLI Slash Commands

| Command | Description |
|---------|-------------|
| `/new` / `/reset` | Start fresh session |
| `/model [name] [--provider p]` | Switch model mid-session |
| `/skill <name> [instruction]` | Invoke a skill |
| `/plan [instruction]` | Create a `.hermes/plans/*.md` plan file |
| `/compress [topic]` | Manually trigger context compression with optional focus |
| `/fast` | Toggle Anthropic Fast Mode / OpenAI Priority |
| `/reasoning [level\|show\|hide]` | Set reasoning effort (minimal → xhigh) |
| `/memory` | Display persistent memory |
| `/session_search <query>` | Search past sessions |
| `/cron [subcmd]` | Manage scheduled jobs |
| `/usage` | Token usage, rate limits, estimated cost |
| `/skin [name]` | Switch display theme |
| `/yolo` | Toggle approval bypass |
| `/rollback [n]` | List or restore filesystem checkpoints |
| `/stop` | Kill all background processes |
| `/btw <question>` | Ephemeral side question (no tools, not persisted) |
| `/background <prompt>` | Run prompt as background agent |
| `/voice [on\|off\|tts]` | Toggle voice input/output |

### `hermes` CLI Subcommands

| Subcommand | Description |
|-----------|-------------|
| `hermes` / `hermes chat` | Interactive agent chat |
| `hermes gateway [run\|start\|stop\|status]` | Messaging gateway lifecycle |
| `hermes model` | Select default model/provider |
| `hermes setup` | Interactive setup wizard |
| `hermes login` / `hermes auth` | Authentication and credential pools |
| `hermes config [show\|edit\|set\|check]` | Configuration management |
| `hermes cron [list\|create\|edit\|pause\|run]` | Scheduled task management |
| `hermes backup` / `hermes import` | Profile backup and restore |
| `hermes skills [search\|install\|publish]` | Skill management |
| `hermes plugins [install\|enable\|disable]` | Plugin management |
| `hermes sessions [list\|browse\|export]` | Session history |
| `hermes logs [--since 1h]` | View filtered logs |
| `hermes mcp [add\|list\|remove]` | MCP server management |
| `hermes doctor` | Diagnose configuration issues |
| `hermes dump` | Copy-pasteable debug summary |
| `hermes profile [list\|create\|switch]` | Multi-profile management |
| `hermes update` | Self-update |

---

## Gateway Platforms (18 total)

| Platform | Protocol | Threading | Notable Features |
|----------|----------|-----------|-----------------|
| **Telegram** | python-telegram-bot (long-poll or webhook) | Forum topics | Approval buttons, emoji reactions, fallback IP for GFW |
| **Discord** | discord.py + REST | Native threads | Native slash commands, voice channel RX (NaCl/DAVE E2EE), thread participation tracking |
| **Slack** | slack-bolt + Socket Mode | Thread ts | Approval buttons with context, multi-workspace, assistant threads |
| **Matrix** | mautrix SDK | in-reply-to | E2EE (python-olm), reactions, read receipts, auto-thread |
| **WeChat (Weixin)** | Tencent iLink Bot API (long-poll) | DM only | AES-128-ECB media encryption, CDN protocol, QR login helper |
| **WeCom** | AI Bot WebSocket | Group + DM | Chunked media upload, allowlist/group policies |
| **WeCom Callback** | Self-built app HTTP callback (XML) | Group + DM | WXBizMsgCrypt decryption, multi-app corp_id scoping |
| **Feishu/Lark** | lark_oapi (WebSocket or webhook) | Interactive cards | Card approval buttons, per-chat serial queue |
| **DingTalk** | dingtalk-stream SDK | Group + DM | Stream Mode WebSocket, 20KB message limit |
| **Signal** | signal-cli HTTP daemon (SSE) | Group + DM | UUID-based users, group internal IDs, full media delivery |
| **BlueBubbles** | macOS local REST API | DM (iMessage) | Tapback reactions, read receipts, private API detection |
| **SMS** | Twilio REST API | DM (E.164) | HMAC signature validation, markdown stripping |
| **Email** | IMAP/SMTP (polling) | DM | Automated sender detection, HTML/plain parsing, attachment caching |
| **Mattermost** | REST API v4 + WebSocket | Threads | Dedup cache, exponential backoff reconnect |
| **WhatsApp** | Node.js bridge (whatsapp-web.js/Baileys) | Group + DM | Multi-backend, Node subprocess, QR auth |
| **API Server** | OpenAI-compatible REST + SSE | Stateless | `/v1/chat/completions`, `/v1/responses`, SQLite LRU ResponseStore |
| **Webhook** | HMAC-signed HTTP POST | Stateless | Per-route HMAC, idempotency cache, dynamic subscriptions |

### Gateway Async Safety

Session variables that would be `os.environ` globals are instead `contextvars.ContextVar` values per asyncio task (`gateway/session_context.py`). Each concurrent message processing task gets an isolated copy. Tool code reads session context via `get_session_env("HERMES_SESSION_*", "")`.

---

## Components & Features

### Self-Improving Skill System

Skills are YAML-frontmatter Markdown files in `~/.hermes/skills/`. The agent is nudged every 15 tool iterations to create new skills after completing complex tasks. 78 built-in skills and 13 optional skills ship with the repo. Skills are published to the Skills Hub via GitHub App JWT. Skills are injected as user-role messages (not system prompt) to preserve Anthropic prefix caching.

### Context Compression

Auto-triggered at 50% of the model's context window. Three-pass: (1) prune old tool results, (2) protect head (first 3 exchanges) and tail (recent 20% by tokens), (3) LLM summarization of the middle with a structured `[CONTEXT COMPACTION]` marker. The `/compress <focus>` command enables guided compression. The summary LLM is configurable via `compression.summary_model` (defaults to main model).

### Multi-Provider Credential Pools

`agent/credential_pool.py` manages multiple API keys per provider with four strategies (fill-first, round-robin, random, least-used). Exhausted keys respect provider-supplied `x-ratelimit-reset` / `reset_at` timestamps. OAuth tokens auto-refresh and sync. All credential data stays in `~/.hermes/.env` and `~/.hermes/config.yaml`.

### Error Classification & Recovery

`agent/error_classifier.py` classifies every API error by priority-ordered pattern matching into a `ClassifiedError` with recovery flags: retry with jittered backoff, rotate credential in pool, compress context, or fall back to next provider. Covers billing exhaustion, rate limits, context overflow, model-not-found, transport timeouts, and provider-specific signatures.

### Pluggable Memory Providers

Eight memory plugins in `plugins/memory/`: byterover, hindsight, holographic, honcho, mem0, openviking, retaindb, supermemory. Only one active at a time via `memory.provider`. All extend `MemoryProvider` ABC with `read()`, `write()`, `search()`, and lifecycle hooks. The built-in memory system uses two SQLite tables (notes + user profile) capped at configurable character limits.

### RL Training Integration

`environments/` provides Atropos-compatible environments. `HermesAgentBaseEnv` handles the two-phase protocol (OpenAI-spec servers Phase 1, VLLM ManagedServer Phase 2), toolset distribution sampling, and `ScoredDataGroup` construction. `AgenticOPDEnv` adds dense token-level training signals via logprob scoring of every tool interaction (On-Policy Distillation).

### Approval & Security

- **Tirith**: Pre-exec command scanning for homograph URLs, shell injection patterns (configurable timeout, fail-open by default)
- **Approval modes**: `manual` (prompt user), `smart` (LLM auto-approve safe commands), `off` (`--yolo`)
- **Permanent allowlist**: `~/.hermes/approvals.json` loaded at startup
- **Gateway approval buttons**: Native Slack/Telegram buttons instead of `/approve` typing
- **MCP OSV scanning**: Automatic vulnerability DB checks on MCP server installs
- **MCP OAuth 2.1 PKCE**: Standards-compliant OAuth for MCP servers
- **Secret redaction**: `RedactingFormatter` ensures API keys are never written to log files

### Profiles & Isolation

`HERMES_HOME` env var scopes all data (config, sessions, memory, skills, logs) to an isolated directory. `get_hermes_home()` in `hermes_constants.py` is the single access point. Tests use `_isolate_hermes_home` autouse fixture — they never touch `~/.hermes/`.

---

## Configuration

### Key Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Anthropic direct API |
| `OPENAI_API_KEY` | OpenAI direct API |
| `OPENROUTER_API_KEY` | OpenRouter multi-provider aggregator |
| `TELEGRAM_BOT_TOKEN` | Telegram gateway |
| `DISCORD_TOKEN` | Discord gateway |
| `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` | Slack gateway |
| `MATRIX_HOMESERVER` + `MATRIX_ACCESS_TOKEN` | Matrix homeserver and token |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_PHONE_NUMBER` | Twilio SMS |
| `HOME_ASSISTANT_TOKEN` + `HOME_ASSISTANT_URL` | Home Assistant |
| `EXA_API_KEY` | Exa web search |
| `FAL_KEY` | FAL.ai image generation |
| `HERMES_HOME` | Profile isolation (default: `~/.hermes`) |
| `HERMES_TIMEZONE` | Timezone for time-aware tools (IANA name) |
| `TERMINAL_CWD` | Override working directory |

### Key `config.yaml` Sections

```yaml
model: ""                          # Default model ("claude-opus-4-6", "gpt-4o", etc.)
providers: {}                      # Per-provider base_url, api_key overrides
fallback_providers: []             # Ordered fallback chain on provider failure

agent:
  max_turns: 90                    # Tool call iterations per conversation turn
  gateway_timeout: 1800            # Max inactivity before timeout (seconds)

terminal:
  backend: "local"                 # local | docker | ssh | modal | singularity | daytona
  timeout: 180                     # Per-command timeout
  docker_image: "nikolaik/python-nodejs:python3.11-nodejs20"
  persistent_shell: true           # Keep shell alive across commands

browser:
  inactivity_timeout: 120          # Auto-close idle sessions

compression:
  enabled: true
  threshold: 0.50                  # Compress at 50% of context window
  summary_model: ""                # Empty = use main model

display:
  skin: "default"                  # Theme (switchable via /skin)
  show_reasoning: false
  streaming: false

memory:
  memory_enabled: true
  provider: ""                     # Empty = built-in; or "mem0", "honcho", "supermemory", etc.
  memory_char_limit: 2200
  user_char_limit: 1375

delegation:
  max_iterations: 50               # Per-subagent tool iteration budget

skills:
  external_dirs: []                # Additional skill search paths

gateway:
  session_reset_policy:
    mode: "both"                   # daily | idle | both | none
    idle_minutes: 1440             # Idle timeout
    at_hour: 4                     # Hour for daily reset
    notify: true
```

---

## Development & Usage

### Prerequisites

- Python 3.11+
- `uv` (recommended) or pip
- Node.js 18+ (only for WhatsApp bridge)

### Setup

```bash
uv venv venv --python 3.11 && source venv/bin/activate
uv pip install -e ".[all,dev]"
cp .env.example ~/.hermes/.env   # add API keys
hermes setup                     # interactive wizard
```

### Running

```bash
hermes                           # Interactive CLI
hermes gateway                   # Messaging gateway
hermes-agent                     # Headless non-interactive agent
hermes gateway status            # Gateway health check
```

### Running Tests

```bash
python -m pytest tests/ -q                          # Full suite (~3,000 tests, ~3 min)
python -m pytest tests/test_model_tools.py -q       # Toolset resolution
python -m pytest tests/gateway/ -q                  # Gateway tests
python -m pytest tests/tools/ -q                    # Tool-level tests
python -m pytest -m integration                     # Integration tests (require API keys)
```

Tests use `conftest.py`'s `_isolate_hermes_home` autouse fixture — tests never write to `~/.hermes/`.

### Building / Deploying

```bash
docker build -t hermes-agent .                # Container (runs as non-root)
nix build                                     # Nix package
hermes gateway install                        # Install as systemd service
hermes gateway start / stop / restart         # Service lifecycle
```

---

## Notable Patterns & Conventions

### File Dependency Chain

```
tools/registry.py  (no deps — imported by all tool files)
       ↑
tools/*.py         (each calls registry.register() at import time)
       ↑
model_tools.py     (imports registry + triggers tool discovery)
       ↑
run_agent.py, cli.py, batch_runner.py, environments/
```

Never import `model_tools.py` from tool files — that would create a circular import.

### Prompt Caching Discipline

The system prompt (identity + memory + skills index + context files) is built **once per session** and never changed. This is required for Anthropic's prefix caching to hit and avoid dramatically increased costs. Context compression is the only permitted mid-conversation change to message history. Toolsets are also frozen at session start for the same reason.

### No `simple_term_menu`

`simple_term_menu` renders incorrectly in tmux and iTerm2. All interactive terminal menus use `curses` instead (see `hermes_cli/tools_config.py`).

### No `\033[K` in Display Code

The ANSI erase-to-EOL sequence leaks as `?[K` under `prompt_toolkit`'s `patch_stdout`. Use space-padding: `f"\r{line}{' ' * pad}"`.

### Cross-Tool Schema References Are Dynamic

Tool schema descriptions must not hard-reference other tool names, because those tools may not be in the active toolset. Cross-references are injected dynamically in `get_tool_definitions()` in `model_tools.py`.

### `_last_resolved_tool_names` Is Process-Global

This mutable global in `model_tools.py` tracks currently-active tool names for dynamic schema injection. `_run_single_child()` in `delegate_tool.py` saves and restores it around subagent execution to prevent cross-contamination.

### Skins Are Pure Data

Add a theme by adding an entry to `_BUILTIN_SKINS` in `hermes_cli/skin_engine.py`, or by dropping a YAML file in `~/.hermes/skins/`. No code changes needed. Activate with `/skin <name>` or `display.skin: <name>` in config.

### Profile-Safe Paths

All `~/.hermes` path resolution must go through `get_hermes_home()` from `hermes_constants.py`. Hardcoded `Path.home() / ".hermes"` paths break profile isolation and fail tests.

### Async Bridge in `model_tools.py`

Tool handlers may be async. `handle_function_call()` dispatches to a persistent per-thread event loop (not `asyncio.run()`, which closes the loop) to preserve cached `httpx.AsyncClient` and `AsyncOpenAI` connection pools across repeated tool calls in the same session.

### COMMAND_REGISTRY Is the Single Source of Truth

All slash commands are defined once in `hermes_cli/commands.py` as `CommandDef` objects. All downstream consumers — CLI dispatch, gateway routing, Telegram button menus, Slack routing, autocomplete, help text — derive from this registry automatically. Adding a command: one registry entry + handler method(s); aliases require only the registry entry.

---

## What Changed: v0.7.0 → v0.8.0

**618 commits, 209 merged PRs, 82 resolved issues — April 3–8, 2026 (5 days)**

### New Gateway Platforms
- **BlueBubbles** — iMessage via macOS local REST API
- **WeChat/Weixin** — via Tencent iLink Bot API (AES-128-ECB encrypted media)
- **WeCom Callback** — self-built app callback mode with XML crypto

### New AI Providers
- Google AI Studio (Gemini) — native provider with models.dev context-length detection
- Xiaomi MiMo — with free-tier gating on Nous Portal
- xAI/Grok — with prompt caching via `x-grok-conv-id` header
- Qwen OAuth

### New TTS/STT Providers
- Voxtral TTS and STT (Mistral AI `speech-2.8`)
- MiniMax TTS

### New Memory Plugins
- Supermemory — multi-container, identity templates, env var overrides

### Agent & Context
- **Background process auto-notifications** — long-running tasks report on completion
- **Inactivity-based agent timeouts** — wall-clock replaced by tool activity tracking
- **`/compress <focus>`** — guided compression preserving a specified topic
- **Self-optimized GPT/Codex tool-use guidance** — behavioral benchmarking auto-patched 5 failure modes
- **Live model switching (`/model`)** — mid-session, across CLI and all gateway platforms

### Infrastructure
- **Centralized logging** — `~/.hermes/logs/` with component separation; `hermes logs` command
- **`hermes backup` / `hermes import`** — profile backup and restore
- **Plugin system expansion** — CLI subcommand registration, request-scoped API hooks, lifecycle events
- **Approval buttons** — native Slack/Telegram buttons replace `/approve` text commands
- **MCP OAuth 2.1 PKCE** — standards-compliant OAuth for MCP servers
- **SSH/Modal bulk file sync** — tar pipe for fast sandbox provisioning
- **Context engine plugin ABC** — third-party context management strategies without core changes
