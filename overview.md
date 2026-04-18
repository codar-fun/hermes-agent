# Hermes Agent

> Self-improving AI agent framework by Nous Research — creates skills from experience, runs everywhere, and connects to 18+ messaging platforms.

**Current version:** 0.10.0 (v2026.4.16, released April 16, 2026)  
**Commit:** `14c7d3e84f1f4690f36784679bd75423ec3eedbd`

---

## Project Info

- **Language / Runtime:** Python 3.11+
- **Framework(s):** OpenAI-compatible chat.completions API (provider-agnostic), Rich + prompt_toolkit (TUI), asyncio (gateway), React + TypeScript (web dashboard)
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
| `openai` | OpenAI-compatible chat.completions client (all non-Anthropic, non-Bedrock providers) |
| `anthropic` | Native Anthropic Messages API (prompt caching, thinking blocks, fast tier) |
| `rich` | Terminal formatting, progress bars, streaming display |
| `prompt_toolkit` | Interactive TUI, keybindings, autocomplete |
| `pydantic` | Config validation and data models |
| `tenacity` | Retry logic with exponential backoff |
| `boto3` | AWS Bedrock Converse API (optional `bedrock` extra) |
| `fastapi` + `uvicorn` | Web dashboard backend (optional `web` extra) |
| `python-telegram-bot` | Telegram gateway adapter |
| `discord.py` | Discord gateway adapter |
| `slack-bolt` | Slack gateway adapter |
| `mautrix` | Matrix gateway adapter (E2EE) |
| `exa-py` / `firecrawl-py` / `parallel-web` | Web search and extraction (firecrawl also used for Nous Tool Gateway) |
| `edge-tts` | Free text-to-speech (no API key) |
| `faster-whisper` | Local speech-to-text |
| `mcp` | Model Context Protocol server support |
| `croniter` | Cron expression parsing |
| `PyJWT` | GitHub App JWT auth for Skills Hub |

---

## Architecture Overview

Hermes is a **monolithic agent framework** with a layered architecture. The same `AIAgent` core powers the interactive CLI, 18 messaging gateway platforms, a browser-based dashboard, batch processing, and RL training environments.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Entry Points                                                            │
│  cli.py (HermesCLI/TUI)  gateway/run.py  web/+web_server.py  mcp_serve  │
│  rl_cli.py               acp_adapter/    batch_runner.py     environments│
└──────────────────────┬───────────────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────────────┐
│  Core Agent Loop  (run_agent.py — AIAgent / run_conversation())          │
│                                                                          │
│  ┌────────────────┐  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │ Prompt Builder │  │ Context Engine  │  │ Error Classifier         │  │
│  │ + Injection    │  │ (pluggable)     │  │ + Retry / Failover       │  │
│  │   Detection    │  │ ContextCompressor│  └──────────────────────────┘  │
│  └────────────────┘  └─────────────────┘  ┌──────────────────────────┐  │
│  ┌────────────────┐  ┌─────────────────┐  │ Credential Pool          │  │
│  │ Auxiliary      │  │ Rate Limit      │  │ + Nous Rate Guard        │  │
│  │ Client         │  │ Tracker         │  └──────────────────────────┘  │
│  └────────────────┘  └─────────────────┘                                │
└──────────────────────┬───────────────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────────────┐
│  Provider Adapters                                                       │
│  OpenAI SDK (all)  Anthropic native  Bedrock Converse  Gemini CloudCode  │
└──────────────────────┬───────────────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────────────┐
│  Tool Layer  (model_tools.py + tools/registry.py)                        │
│                                                                          │
│  terminal  file  web  browser  vision  delegate  memory  mcp             │
│  code_exec  tts  send_message  todo  skills  cron  homeassistant         │
│  managed_tool_gateway (Nous Portal subscribers)                          │
└──────────────────────┬───────────────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────────────┐
│  Persistence & Security                                                  │
│  SQLite (sessions/messages/FTS5)  ~/.hermes/  trajectory.jsonl           │
│  tirith (pre-exec scanning)  skills_guard  osv_check  url_safety         │
└──────────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Decisions

- **Synchronous agent core, async gateway:** `run_conversation()` is fully synchronous; the gateway runs asyncio and dispatches agents via `run_in_executor`.
- **Provider-agnostic via OpenAI SDK:** All providers accessed via `openai.OpenAI` with custom `base_url`. Exceptions: Anthropic native (prompt caching, thinking), AWS Bedrock (boto3 Converse API), Google Cloud Code Assist (PKCE OAuth facade).
- **Tool self-registration:** Every tool file calls `registry.register()` at import time. `model_tools.py` is the only importer, triggering discovery.
- **No mid-conversation context mutation:** System prompt and toolsets are frozen per session to preserve Anthropic prefix caching. Only context compression may mutate the message list.
- **Skills as user messages:** Skill content injected as user-role messages to avoid invalidating the cached system-prompt prefix.
- **Pluggable context engine:** `agent/context_engine.py` defines an ABC; the built-in `ContextCompressor` is the default. Third-party engines drop into `plugins/context_engine/<name>/`.

---

## Directory Structure

```
hermes-agent/
├── cli.py                    # HermesCLI — interactive TUI (9,800+ LOC)
├── run_agent.py              # AIAgent — synchronous agent loop (10,500+ LOC)
├── model_tools.py            # Tool discovery, dispatch, get_tool_definitions()
├── toolsets.py               # Toolset groupings (_HERMES_CORE_TOOLS, per-platform)
├── toolset_distributions.py  # Weighted toolset sampling for RL training
├── hermes_constants.py       # get_hermes_home(), paths, provider URLs, is_termux()
├── hermes_state.py           # SQLite session/message store (schema v6, FTS5, WAL)
├── hermes_logging.py         # Centralized logging with RedactingFormatter
├── hermes_time.py            # Timezone-aware clock (HERMES_TIMEZONE / config.yaml)
├── mcp_serve.py              # MCP server exposing gateway conversations (9 tools)
│
├── agent/                    # Agent infrastructure
│   ├── anthropic_adapter.py  # Anthropic Messages API: caching, thinking, fast tier
│   ├── auxiliary_client.py   # Unified aux LLM resolver (7-tier chain)
│   ├── bedrock_adapter.py    # AWS Bedrock Converse API (boto3, inference profiles)
│   ├── gemini_cloudcode_adapter.py  # Google Cloud Code Assist OAuth facade
│   ├── google_code_assist.py # Code Assist control-plane: tier, onboarding, quota
│   ├── google_oauth.py       # PKCE OAuth for Gemini CLI (S256, cross-process lock)
│   ├── nous_rate_guard.py    # Shared cross-session 429 cooldown file
│   ├── context_compressor.py # Lossy summarization (2K–12K token budgets)
│   ├── context_engine.py     # Pluggable context engine ABC + lifecycle hooks
│   ├── context_references.py # Cross-session reference resolution
│   ├── credential_pool.py    # Multi-key pool (4 strategies, 1h exhaustion TTL)
│   ├── display.py            # KawaiiSpinner, streaming helpers
│   ├── error_classifier.py   # API error taxonomy → recovery flags
│   ├── manual_compression_feedback.py  # /compress <focus> guided compression
│   ├── memory_manager.py     # Memory read/write scheduling
│   ├── memory_provider.py    # MemoryProvider ABC
│   ├── model_metadata.py     # Context length detection, token estimation
│   ├── models_dev.py         # models.dev provider registry
│   ├── prompt_builder.py     # System prompt assembly + injection detection
│   ├── rate_limit_tracker.py # x-ratelimit-* header parsing
│   ├── retry_utils.py        # Jittered exponential backoff
│   ├── skill_commands.py     # /skill and /plan helpers
│   ├── skill_utils.py        # Skill SKILL.md frontmatter parsing
│   └── smart_model_routing.py# Cheap-vs-strong routing for simple turns
│
├── tools/                    # Tool implementations (self-registering at import)
│   ├── registry.py           # Central registry — no deps, imported by everything
│   ├── approval.py           # Dangerous command detection and approval flow
│   ├── terminal_tool.py      # terminal, process — 6 backends
│   ├── file_tools.py         # read_file, write_file, patch, search_files
│   ├── web_tools.py          # web_search, web_extract
│   ├── browser_tool.py       # browser_* — Playwright sessions
│   ├── browser_camofox.py    # Camofox anti-detection browser (REST → Node.js)
│   ├── browser_camofox_state.py  # Profile-scoped persistent Camofox identities
│   ├── browser_providers/    # Firecrawl, Browserbase, Browser Use backends
│   ├── managed_tool_gateway.py   # Nous Tool Gateway (paid Portal subscribers)
│   ├── vision_tools.py       # vision_analyze
│   ├── image_generation_tool.py  # image_generate (DALL-E, Flux, FAL)
│   ├── delegate_tool.py      # delegate_task — isolated subagents
│   ├── code_execution_tool.py# execute_code — Python with full tool access
│   ├── memory_tool.py        # memory — durable notes + user profile
│   ├── todo_tool.py          # todo — task list management
│   ├── session_search_tool.py# session_search — FTS5 across sessions
│   ├── mcp_tool.py           # MCP server tool proxy
│   ├── mcp_oauth.py          # MCP OAuth 2.1 PKCE (token storage, step-up)
│   ├── skill_manager_tool.py # skill_manage — create/edit/delete/publish
│   ├── skills_tool.py        # skills_list, skill_view
│   ├── skills_hub.py         # Skills registry (GitHub, ClawHub, Marketplace)
│   ├── skills_sync.py        # Manifest-based bundled skill syncing (v2)
│   ├── skills_guard.py       # Static analysis scanner (trust levels + verdicts)
│   ├── send_message_tool.py  # send_message — cross-platform delivery
│   ├── tts_tool.py           # text_to_speech (6 providers)
│   ├── voice_mode.py         # Voice input/output integration
│   ├── clarify_tool.py       # clarify — ask user questions
│   ├── cronjob_tools.py      # cronjob — scheduled task management
│   ├── homeassistant_tool.py # ha_* — Home Assistant integration
│   ├── mixture_of_agents_tool.py  # mixture_of_agents
│   ├── rl_training_tool.py   # rl_* — RL training (10 tools)
│   ├── tirith_security.py    # Pre-exec command scanning (cosign-verified auto-install)
│   ├── osv_check.py          # OSV malware check for MCP packages (MAL-* only)
│   ├── url_safety.py         # SSRF protection (private IPs, CGNAT, DNS rebind)
│   ├── website_policy.py     # User-managed website blocklist (fnmatch, 30s cache)
│   ├── path_security.py      # Shared symlink/traversal path validation
│   ├── budget_config.py      # Per-result and per-turn size limits (100K/200K)
│   └── [+ more tool files]
│
├── hermes_cli/               # CLI subcommands and config
│   ├── main.py               # All `hermes <subcommand>` entry points (31+ subcommands)
│   ├── commands.py           # COMMAND_REGISTRY — all 42 slash commands defined here
│   ├── config.py             # DEFAULT_CONFIG, load_config(), full config schema
│   ├── auth.py               # OAuth flows, 15+ providers, device auth
│   ├── auth_commands.py      # `hermes auth` subcommands
│   ├── backup.py             # `hermes backup` / `hermes import`
│   ├── debug.py              # `hermes debug share/delete` — paste lifecycle
│   ├── web_server.py         # FastAPI backend for local web dashboard
│   ├── skin_engine.py        # Skin/theme system (pure YAML data, no code needed)
│   ├── tools_config.py       # curses-based tool selection TUI
│   ├── cli_output.py         # Shared CLI output helpers
│   ├── claw.py               # OpenClaw migration utilities
│   └── [+ more files]
│
├── web/                      # Local web dashboard (React + TypeScript + Vite)
│   └── src/
│       ├── App.tsx           # Router + navigation
│       ├── pages/            # Status, Sessions, Config, Env, Logs, Cron, Skills, Analytics
│       ├── i18n/             # English + Chinese translations
│       └── [50+ TS/CSS files]
│
├── gateway/                  # Async messaging gateway
│   ├── run.py                # GatewayRunner, main async loop (~8,500 LOC)
│   ├── config.py             # Platform enum (18 platforms), PlatformConfig
│   ├── session.py            # SessionSource, SessionResetPolicy, SessionStore
│   ├── session_context.py    # contextvars for async-safe per-task session state
│   ├── stream_consumer.py    # Progressive message editing, thinking suppression
│   ├── display_config.py     # Per-platform display verbosity (4-tier resolution)
│   ├── pairing.py            # Code-based DM authorization (HMAC, lockout, TTL)
│   └── platforms/
│       ├── base.py           # BasePlatformAdapter + proxy support + media caching
│       ├── helpers.py        # MessageDeduplicator, TextBatchAggregator, ThreadTracker
│       ├── telegram.py       ├── discord.py   ├── slack.py    ├── matrix.py
│       ├── weixin.py         ├── wecom.py     ├── wecom_callback.py
│       ├── feishu.py         ├── dingtalk.py  ├── signal.py
│       ├── bluebubbles.py    ├── sms.py       ├── email.py    ├── mattermost.py
│       ├── whatsapp.py       ├── webhook.py   └── api_server.py
│
├── cron/
│   ├── scheduler.py          # tick() — due-job evaluation, 14-platform delivery
│   └── jobs.py               # Job CRUD, cron expression parsing, output persistence
│
├── environments/             # RL training (Atropos-compatible)
│   ├── agent_loop.py         # HermesAgentLoop — reusable multi-turn eval engine
│   ├── hermes_base_env.py    # HermesAgentBaseEnv — abstract base, two-phase protocol
│   ├── agentic_opd_env.py    # On-Policy Distillation (dense logprob training signals)
│   ├── web_research_env.py   # FRAMES benchmark environment
│   └── benchmarks/           # terminalbench_2, yc_bench, tblite
│
├── plugins/
│   ├── memory/               # 9 memory providers: byterover, hindsight, holographic,
│   │                         #   honcho, mem0, openviking, retaindb, supermemory
│   └── context_engine/       # Pluggable context strategy slot
│
├── skills/                   # 27 built-in skill directories
├── optional-skills/          # 14 optional skill categories
├── acp_adapter/              # ACP server (VS Code / JetBrains / Zed)
├── tests/                    # 521+ test files (pytest, pytest-asyncio, -xdist)
│
├── pyproject.toml            # Version 0.10.0, optional extras, entry points
├── cli-config.yaml.example   # All config options annotated
├── .env.example              # All environment variables with descriptions
├── SECURITY.md               # Trust model, approval system, sandbox policy
├── AGENTS.md                 # Complete developer reference
└── Dockerfile                # Non-root containerization (Node 22)
```

---

## Data Structures & Models

### Message Format (OpenAI-compatible, internal wire format)

```python
{
    "role": "user" | "assistant" | "tool",
    "content": str | [{"type": "text", "text": "..."}, {"type": "image_url", ...}],
    # assistant only:
    "tool_calls": [{"id": str, "type": "function",
                    "function": {"name": str, "arguments": str}}],
    "reasoning_content": str,   # thinking blocks (Anthropic / xAI)
    "reasoning_details": str,   # structured reasoning JSON
    # tool only:
    "tool_call_id": str,
    "name": str
}
```

### Session DB Schema (SQLite `~/.hermes/state.db`, schema v6, WAL mode)

| Table | Key Fields |
|-------|-----------|
| `sessions` | id, source, user_id, model, system_prompt, parent_session_id, cache_read_tokens, cache_write_tokens, reasoning_tokens, billing_provider, estimated_cost_usd, actual_cost_usd |
| `messages` | id, session_id, role, content, tool_calls, reasoning, reasoning_details, codex_reasoning_items, created_at |
| `messages_fts` | FTS5 virtual table over messages.content |

### PooledCredential (`agent/credential_pool.py`)

```python
provider, id, label, auth_type, priority
access_token, refresh_token, expires_at
base_url, inference_base_url
runtime_api_key, runtime_base_url       # computed properties
last_status, last_error_code, last_error_reset_at
# TTL: 1h for both 429 (rate-limit) and 402 (billing exhaustion)
```

Strategies: `fill_first`, `round_robin`, `random`, `least_used`.

### MessageEvent (gateway normalized format)

```python
text: str
message_type: MessageType  # TEXT, PHOTO, AUDIO, VIDEO, DOCUMENT, VOICE, STICKER, COMMAND
source: SessionSource      # platform, chat_id, user_id, thread_id, chat_name, chat_type
media_urls: list[str]      # local cache paths
reply_to_message_id: str | None
auto_skill: str | None     # channel-bound skill binding
internal: bool             # bypass auth checks
timestamp: datetime
```

### ClassifiedError (`agent/error_classifier.py`)

```python
reason: FailoverReason     # auth, billing, rate_limit, overloaded, context_overflow,
                           # model_not_found, usage_limit, vpc_sc_violation, ...
retryable: bool
should_compress: bool
should_rotate_credential: bool
should_fallback: bool
status_code: int | None
provider: str
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
6.  Sanitize (surrogates, non-ASCII, \r\n normalization)
7.  build_system_prompt() → identity + memory + skills index + context files
    (frozen for session — preserves Anthropic prefix cache)

8.  ─── TOOL LOOP (up to max_turns = 90) ──────────────────────────────
    a. Select provider adapter: OpenAI SDK | Anthropic native | Bedrock | Gemini
    b. API call (fast tier if /fast active)
    c. Receive: text tokens | tool_calls | reasoning blocks
    d. If tool_calls:
       - Coerce argument types to JSON Schema
       - Tirith pre-exec security scan (if terminal tool)
       - Classify parallelism: read-only → parallel / destructive → serial
       - dispatch via model_tools.handle_function_call()
         → tools/registry.py → handler → JSON result string
       - If oversized result → save to file, return path
       - Append tool results; touch _last_activity_ts heartbeat
    e. If text → stream to terminal
    f. Check token usage → compress if > threshold (context_engine)
    g. On API error → error_classifier → retry | rotate cred | compress | fallback
    h. Delegate task → child activity propagates to parent heartbeat
    i. Repeat until text-only response or budget exhausted
    ────────────────────────────────────────────────────────────────────

9.  Save session → hermes_state.py (SQLite, WAL)
10. Display cost, rate limits (/usage)
```

### Gateway Message Flow

```
Platform adapter receives native event
    ↓
Build normalized MessageEvent
    ↓
set_session_vars() → contextvars.ContextVar (isolated per asyncio task)
    ↓
Authorization: allowlist check / pairing code validation
    ↓
Load SessionStore (conversation history + memory)
    ↓
Apply session reset policy (daily / idle / both)
    ↓
run_in_executor(agent.run_conversation())  — synchronous in thread pool
    ↓ stream deltas
GatewayStreamConsumer → progressive platform message edits
    (per-platform display verbosity from display_config.py)
    ↓
adapter.send() → platform REST/WebSocket API
    ↓
Save session
```

### Provider Selection Flow

```
User-configured provider (config.yaml / /model)
    ↓
Credential pool: fill_first | round_robin | random | least_used
    ↓ 429 or 402?
  ├─ Record in nous_rate_guard.py if Nous Portal
  ├─ Mark credential exhausted (1h TTL)
  └─ Rotate to next credential in pool
    ↓ all credentials exhausted?
Fallback providers list (config.yaml fallback_providers[])
    ↓ all exhausted?
Return error to user
```

### Context Compression Flow

```
token_usage > threshold (default 50% of context window)
    ↓
context_compressor.py three-pass:
  1. Pre-pass: prune large tool results → one-liner summaries
     (e.g. "[terminal] npm test → exit 0, 47 lines")
  2. Protect head (system + first 3 exchanges)
     Protect tail (recent 20% by tokens, min protect_last_n=20)
  3. LLM summarization of middle with template:
       [CONTEXT COMPACTION — REFERENCE ONLY]
       [Resolved] [Pending] [Remaining Work]
  Summary budget: 2,000–12,000 tokens (20% of compressed content)
    ↓
Iterative updates: summaries merge across multiple compactions
    ↓
/compress <focus> — user-guided: preserves specified topic
```

---

## LLM Provider Adapters

| Provider | Adapter | Auth | Notes |
|----------|---------|------|-------|
| OpenAI, OpenRouter, Nous Portal, custom | OpenAI SDK | API key / OAuth | Default path for all OpenAI-compatible endpoints |
| Anthropic | `anthropic_adapter.py` | API key / OAuth | Native caching, thinking blocks, fast tier via `extra_body` |
| AWS Bedrock | `bedrock_adapter.py` | boto3 credential chain (5 sources) | Converse API; inference profiles (us/eu/global); guardrails; routes Claude to native SDK for caching |
| Google Cloud Code Assist / Gemini CLI | `gemini_cloudcode_adapter.py` + `google_code_assist.py` + `google_oauth.py` | PKCE OAuth S256 | Free-tier vs. paid project routing; VPC-SC handling; `/gquota` command; public gemini-cli client ID |
| xAI (Grok) | OpenAI SDK | API key | Prompt caching via `x-grok-conv-id` header |
| Xiaomi MiMo | OpenAI SDK | API key | Empty response recovery for reasoning models |
| Qwen | OpenAI SDK | OAuth | Portal request support |
| MiniMax | OpenAI SDK | API key | Context length corrections, thinking guard |
| z.ai | OpenAI SDK | API key | Endpoint auto-detect via probe+cache |
| Local (Ollama, LM Studio, vLLM, llama.cpp) | OpenAI SDK | None | Context length from `GET /api/tags` (Ollama) |

### Auxiliary Client Resolution Chain (`agent/auxiliary_client.py`)

For side tasks (compression summarization, vision analysis, web extraction):

```
Text tasks:   OpenRouter → Nous Portal → Custom endpoint → Codex OAuth
              → Anthropic → Direct providers (Gemini, z.ai, Kimi, MiniMax) → None

Vision tasks: Main provider (if capable) → OpenRouter → Nous Portal
              → Codex OAuth → Anthropic → Custom endpoint → None
```

HTTP 402 (credit exhaustion) triggers immediate fallback to next provider in chain.

---

## Main API / Interfaces

### Tool Registry (46+ tools, 10 toolsets)

| Tool | Toolset | Description |
|------|---------|-------------|
| `terminal` | terminal | Execute shell commands (local, Docker, SSH, Modal, Singularity, Daytona) |
| `process` | terminal | List, kill, monitor background processes; `watch_patterns` for real-time alerts |
| `read_file` | file | Read file with offset/limit |
| `write_file` | file | Create or overwrite files |
| `patch` | file | Fuzzy string-replace patch |
| `search_files` | file | Regex content search + filename glob |
| `web_search` | web | Web search (Exa, Firecrawl, Parallel, Tavily; or Nous Tool Gateway) |
| `web_extract` | web | Extract/summarize URLs as Markdown |
| `browser_navigate` | browser | Navigate URL (Playwright / Camofox / Browserbase / Browser Use) |
| `browser_snapshot` | browser | Screenshot (viewport or full page) |
| `browser_click/type/scroll/press/back/console/vision` | browser | Full browser interaction |
| `vision_analyze` | vision | Analyze images with multimodal LLM |
| `image_generate` | image_gen | Generate images (DALL-E 3, Flux, FAL; or Nous Tool Gateway) |
| `execute_code` | code_execution | Run Python with full tool access |
| `delegate_task` | delegation | Spawn isolated subagent with own iteration budget |
| `memory` | memory | Read/write persistent notes and user profile |
| `todo` | todo | Task list (create, update, list, complete) |
| `session_search` | session_search | FTS5 full-text search across past sessions |
| `clarify` | clarify | Ask user a question (multiple-choice or open) |
| `skills_list` / `skill_view` | skills | Browse and inspect available skills |
| `skill_manage` | skills | Create, edit, delete, publish skills |
| `text_to_speech` | tts | TTS: Edge (free), ElevenLabs, OpenAI, MiniMax, Voxtral; or Nous Tool Gateway |
| `send_message` | messaging | Cross-platform message delivery |
| `cronjob` | cronjob | Create, list, edit, pause, resume scheduled tasks |
| `mixture_of_agents` | moa | Multi-agent reasoning panel |
| `ha_*` (4 tools) | homeassistant | Home Assistant entity/service control |
| `rl_*` (10 tools) | rl | RL training management (environments, config, runs, results) |

### CLI Slash Commands (42 total, single source: `hermes_cli/commands.py`)

**Session:**

| Command | Description |
|---------|-------------|
| `/new` / `/reset` | Start fresh session |
| `/title [name]` | Set session title |
| `/branch` / `/fork` | Branch session to explore alternate path |
| `/compress [topic]` | Manually compress context with optional focus |
| `/rollback [n]` | List or restore filesystem checkpoints |
| `/stop` | Kill all background processes |
| `/approve [session\|always]` | Approve pending dangerous command (gateway) |
| `/deny` | Deny pending dangerous command (gateway) |
| `/background <prompt>` / `/bg` | Run prompt as background agent |
| `/btw <question>` | Ephemeral side question (no tools, not persisted) |
| `/queue <prompt>` / `/q` | Queue prompt for next turn |
| `/steer <prompt>` | Inject note after next tool call (mid-run, no interrupt) |
| `/status` | Show session info |
| `/resume [name]` | Resume previously-named session |
| `/sethome` | Set this chat as home channel (gateway) |

**Configuration:**

| Command | Description |
|---------|-------------|
| `/model [name] [--provider p]` | Switch model mid-session |
| `/fast [normal\|fast\|status]` | Toggle Anthropic Fast Tier / OpenAI Priority |
| `/reasoning [level\|show\|hide]` | Set reasoning effort (minimal → xhigh) |
| `/personality [name]` | Apply predefined personality overlay |
| `/yolo` | Toggle approval bypass |
| `/skin [name]` | Switch display theme |
| `/voice [on\|off\|tts\|status]` | Toggle voice input/output |
| `/verbose` | Cycle tool progress verbosity (config-gated) |
| `/gquota` | Show Google Gemini Code Assist quota |

**Tools & Skills:**

| Command | Description |
|---------|-------------|
| `/tools [list\|disable\|enable] [name]` | Manage tools (CLI) |
| `/skills [search\|browse\|inspect\|install]` | Manage skills (CLI) |
| `/cron [subcmd]` | Manage scheduled jobs (CLI) |
| `/reload-mcp` | Reload MCP servers from config |
| `/browser [connect\|disconnect\|status]` | Connect CDP browser (CLI) |
| `/plugins` | List installed plugins (CLI) |

**Info & Debug:**

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/usage` | Token usage, rate limits, estimated cost |
| `/insights [days]` | Usage analytics |
| `/debug` | Upload debug report (paste.rs / dpaste.com) |
| `/profile` | Show active profile |
| `/commands [page]` | Browse all commands paginated (gateway) |
| `/update` | Self-update (gateway) |

### `hermes` CLI Subcommands (31+)

| Subcommand | Description |
|-----------|-------------|
| `hermes` / `hermes chat` | Interactive agent chat |
| `hermes gateway [run\|start\|stop\|status\|install]` | Gateway lifecycle |
| `hermes model` | Select default model/provider |
| `hermes setup [section]` | Interactive setup wizard |
| `hermes login` / `hermes auth` | Authentication and credential pools |
| `hermes config [show\|edit\|set\|check\|migrate]` | Config management |
| `hermes cron [list\|create\|edit\|pause\|run\|remove]` | Scheduled tasks |
| `hermes webhook [subscribe\|list\|remove\|test]` | Webhook subscriptions |
| `hermes backup [-o]` | Backup config/sessions/skills/memory to zip |
| `hermes import <zipfile>` | Restore from backup |
| `hermes dashboard [--port 9119]` | Start local web UI |
| `hermes debug [share\|delete]` | Upload/delete debug report pastes |
| `hermes skills [search\|install\|publish\|tap\|snapshot]` | Skill management |
| `hermes plugins [install\|enable\|disable\|list]` | Plugin management |
| `hermes sessions [list\|browse\|export\|prune\|delete]` | Session history |
| `hermes logs [name] [-f] [--since]` | View and filter logs |
| `hermes mcp [serve\|add\|list\|remove\|login]` | MCP server management |
| `hermes memory [setup\|status\|reset]` | Memory provider config |
| `hermes tools [list\|disable\|enable]` | Tool configuration per platform |
| `hermes doctor [--fix]` | Diagnose config and dependencies |
| `hermes dump [--show-keys]` | Copy-pasteable debug summary |
| `hermes profile` | Show active profile |
| `hermes pairing [list\|approve\|revoke]` | DM pairing management |
| `hermes status [--deep]` | Component health check |
| `hermes insights [days]` | Usage analytics |
| `hermes update` | Self-update |
| `hermes version` | Show version |
| `hermes completion [bash\|zsh\|fish]` | Shell completion |
| `hermes acp` | Run as ACP server |
| `hermes uninstall` | Uninstall |

---

## Gateway Platforms (18 total)

| Platform | Protocol | Threading | Notable Features |
|----------|----------|-----------|-----------------|
| **Telegram** | python-telegram-bot (long-poll or webhook) | Forum topics | Approval buttons, emoji reactions, paginated model picker, GFW fallback IP |
| **Discord** | discord.py + REST | Native threads | Native slash commands (/steer, /approve, etc.), voice RX (NaCl/DAVE E2EE), forum channels, allowed-channels whitelist |
| **Slack** | slack-bolt + Socket Mode | Thread ts | Approval buttons with thread context, multi-workspace, assistant threads |
| **Matrix** | mautrix SDK | in-reply-to | E2EE (python-olm), reactions, read receipts, SQLite crypto store |
| **WeChat (Weixin)** | Tencent iLink Bot API (long-poll) | DM only | AES-128-ECB media encryption, CDN protocol, QR login, atomic state persistence |
| **WeCom** | AI Bot WebSocket | Group + DM | Chunked media upload, allowlist/group policies, dedup cache |
| **WeCom Callback** | Self-built app HTTP callback (XML) | Group + DM | WXBizMsgCrypt XML decryption, multi-app corp_id scoping, access token cache |
| **Feishu/Lark** | lark_oapi (WebSocket or webhook) | Interactive cards | Card approval buttons, per-chat serial queue, document comments (feishu_comment.py) |
| **DingTalk** | dingtalk-stream SDK | Group + DM | AI Cards streaming, emoji reactions, 20KB message limit |
| **Signal** | signal-cli HTTP daemon (SSE) | Group + DM | UUID-based users, full media delivery (image/voice/video/document) |
| **BlueBubbles** | macOS local REST API | DM (iMessage) | Tapback reactions, read receipts, private API detection, auto-webhook registration |
| **SMS** | Twilio REST API | DM (E.164) | HMAC signature validation (RCE fix in v0.9.0), markdown stripping |
| **Email** | IMAP/SMTP (polling) | DM | Automated sender detection, HTML/plain parsing, attachment caching |
| **Mattermost** | REST API v4 + WebSocket | Threads | Dedup cache, exponential backoff reconnect |
| **WhatsApp** | Node.js bridge | Group + DM | Multi-backend (whatsapp-web.js / Baileys), QR auth |
| **API Server** | OpenAI-compatible REST + SSE | Stateless | `/v1/chat/completions`, `/v1/responses`, SQLite LRU ResponseStore, API key auth |
| **Webhook** | HMAC-signed HTTP POST | Stateless | Per-route HMAC, idempotency cache, dynamic subscriptions |

### Per-Platform Display Verbosity (`gateway/display_config.py`)

Four-tier resolution: per-platform override → global setting → platform default → global default.

| Tier | Platforms | Default |
|------|-----------|---------|
| High | Telegram, Discord | `tool_progress: all` |
| Medium | Slack, Mattermost, Matrix, Feishu | `tool_progress: new` |
| Low | Signal, WhatsApp, BlueBubbles, WeChat/WeCom | `tool_progress: new` |
| Minimal | Email, SMS, Webhook, Home Assistant | `tool_progress: off` |

### Proxy Support

`gateway/platforms/base.py` provides:
- `_detect_macos_system_proxy()` — macOS `scutil` auto-detection
- `resolve_proxy_url()` — env vars + system proxy
- `proxy_kwargs_for_bot()` — discord.py SOCKS/HTTP integration
- `proxy_kwargs_for_aiohttp()` — aiohttp ProxyConnector

Activated via `DISCORD_PROXY`, `HTTPS_PROXY`, or macOS system proxy settings.

---

## Security Layer

### Pre-Execution Command Scanning (tirith)

`tools/tirith_security.py` wraps the `tirith` binary (auto-downloaded from GitHub releases with cosign provenance + SHA-256 verification):

- **Threats:** homograph URLs, pipe-to-interpreter, shell injection, credential exfiltration
- **Verdicts:** 0=allow, 1=block, 2=warn
- **Fail mode:** `tirith_fail_open: true` (default) — allow on timeout or unavailable
- **Config:** `security.tirith_enabled`, `security.tirith_path`, `security.tirith_timeout`

### Approval System (`tools/approval.py`)

- **Modes:** `manual` (prompt user), `smart` (LLM auto-approve safe commands), `off` (--yolo)
- **Permanent allowlist:** `~/.hermes/approvals.json` loaded at startup
- **Gateway buttons:** Native Slack/Telegram approval buttons (no typing `/approve`)
- **Authorization:** Approval buttons require the requesting user to confirm

### Skills Security (`tools/skills_guard.py`)

Static analysis scanner for externally-sourced skills before install:

| Trust Level | Source | Caution Verdict | Dangerous Verdict |
|-------------|--------|-----------------|-------------------|
| `builtin` | Ships with Hermes | Allow | Allow |
| `trusted` | OpenAI/Anthropic | Allow | Block |
| `community` | Hub/GitHub | Block | Block |
| `agent-created` | Self-generated | Allow | Ask |

Threat categories: exfiltration, injection, destructive, persistence, network, obfuscation.

### SSRF Protection (`tools/url_safety.py`)

Blocks: private IPs, loopback, link-local, CGNAT (`100.64.0.0/10`), multicast, `metadata.google.internal`, `metadata.goog`. Applied to all outbound HTTP from web tools and image fetching.

### Prompt Injection Detection (`agent/prompt_builder.py`)

10 regex patterns + invisible Unicode detection block malicious content in context files (SOUL.md, AGENTS.md, .cursorrules) before injection into system prompt. Patterns cover: instruction override, deception, bypass, HTML comment injection, hidden divs, translate-then-execute, credential exfiltration, secret file reads.

### MCP Security

- **OSV check** (`tools/osv_check.py`): queries OSV API before installing MCP packages; blocks `MAL-*` advisories only
- **OAuth 2.1 PKCE** (`tools/mcp_oauth.py`): full authorization code flow, persistent token storage in `~/.hermes/mcp-tokens/`, step-up auth

### Credential Protection

- `agent/redact.py` + `RedactingFormatter` in logging: API keys never written to log files
- Child processes for `execute_code` and `delegate_task` have credentials stripped from environment
- `agent/nous_rate_guard.py`: shared `~/.hermes/rate_limits/nous.json` prevents 429 retry amplification across sessions

---

## Nous Tool Gateway (v0.10.0)

Paid Nous Portal subscribers automatically get access to managed tool backends — no separate API keys required:

| Tool | Gateway Backend |
|------|----------------|
| `web_search` / `web_extract` | Firecrawl |
| `image_generate` | FAL / FLUX 2 Pro |
| `text_to_speech` | OpenAI TTS |
| `browser_*` | Browser Use |

**Detection:** `managed_tool_gateway.py` checks for active paid subscription (not free tier). Gateway activates automatically when detected. Per-tool opt-in via `use_gateway` config key. Replaces the former hidden `HERMES_ENABLE_NOUS_MANAGED_TOOLS` env var.

---

## Web Dashboard (v0.9.0+)

Local browser-based management UI at `http://127.0.0.1:9119` (default).

**Frontend:** React + TypeScript + Vite (`web/src/`), with 6 built-in themes (default, midnight, ember, mono, cyberpunk, rose) and English/Chinese i18n.

**Pages:** Status · Sessions · Config · Env (API keys) · Logs · Cron · Skills · Analytics

**Backend:** `hermes_cli/web_server.py` (FastAPI):
- Session token auth (HMAC-based, ephemeral)
- Rate-limiting on secret-revealing endpoints
- CORS restricted to localhost origins
- Auto-detects running gateway via HTTP health probe + PID tracking

**Start:** `hermes dashboard [--port 9119] [--host 127.0.0.1] [--no-open] [--insecure]`

---

## MCP Server (`mcp_serve.py`)

Exposes gateway conversations as MCP tools for Claude Code, Cursor, Codex, and other MCP-compatible editors.

**9-tool surface:**

| Tool | Description |
|------|-------------|
| `conversations_list` | List available conversations |
| `conversation_get` | Get conversation details |
| `messages_read` | Read messages from a conversation |
| `attachments_fetch` | Fetch message attachments |
| `events_poll` / `events_wait` | Poll or wait for new events |
| `messages_send` | Send a message to a conversation |
| `permissions_list_open` | List pending permission requests |
| `permissions_respond` | Respond to a permission request |
| `channels_list` | List available channels |

**Usage:** `hermes mcp serve` (stdio transport) or add to `claude_desktop_config.json`.

---

## Configuration

### Key Environment Variables

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Anthropic direct API |
| `OPENAI_API_KEY` | OpenAI direct API |
| `OPENROUTER_API_KEY` | OpenRouter aggregator |
| `GEMINI_API_KEY` | Google AI Studio / Gemini |
| `XIAOMI_API_KEY` | Xiaomi MiMo |
| `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` | AWS Bedrock (or use profile/IMDS) |
| `TELEGRAM_BOT_TOKEN` | Telegram gateway |
| `DISCORD_TOKEN` | Discord gateway |
| `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` | Slack gateway |
| `MATRIX_HOMESERVER` + `MATRIX_ACCESS_TOKEN` | Matrix |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_PHONE_NUMBER` | SMS |
| `HOME_ASSISTANT_TOKEN` + `HOME_ASSISTANT_URL` | Home Assistant |
| `EXA_API_KEY` | Exa web search |
| `FAL_KEY` | FAL.ai image generation |
| `CAMOFOX_URL` | Local Camofox anti-detection browser |
| `HERMES_HOME` | Profile isolation directory (default: `~/.hermes`) |
| `HERMES_TIMEZONE` | IANA timezone name |
| `TOOL_GATEWAY_USER_TOKEN` | Nous Tool Gateway override |

### Key `config.yaml` Sections

```yaml
model: ""                          # "claude-opus-4-6", "gpt-4o", "grok-3", etc.
providers: {}                      # per-provider base_url, api_key overrides
fallback_providers: []             # ordered failover chain

agent:
  max_turns: 90                    # tool iteration budget per conversation turn
  gateway_timeout: 1800            # inactivity timeout (activity-based, not wall-clock)
  gateway_timeout_warning: 900     # staged warning before timeout
  gateway_notify_interval: 600     # "still working" heartbeat to user (0=off)

terminal:
  backend: "local"                 # local | docker | ssh | modal | singularity | daytona
  timeout: 180
  persistent_shell: true           # keep shell alive across commands

compression:
  enabled: true
  threshold: 0.50                  # compress at 50% of context window
  protect_last_n: 20               # minimum recent messages to keep uncompressed
  summary_model: ""                # empty = use main model

context:
  engine: "compressor"             # pluggable: "compressor" | plugin name

display:
  skin: "default"
  show_reasoning: false
  streaming: false
  platforms:                       # per-platform display overrides
    telegram:
      tool_progress: "all"

memory:
  memory_enabled: true
  provider: ""                     # "" = built-in | "mem0" | "honcho" | "supermemory" | ...

delegation:
  max_iterations: 50               # per-subagent iteration budget

security:
  tirith_enabled: true
  tirith_fail_open: true
  website_blocklist:
    enabled: false
    domains: []

network:
  force_ipv4: false                # fix broken IPv6 environments

gateway:
  session_reset_policy:
    mode: "both"                   # daily | idle | both | none
    idle_minutes: 1440
    at_hour: 4
    notify: true
```

---

## Optional Extras (`pyproject.toml`)

| Extra | Contents |
|-------|---------|
| `bedrock` | `boto3` — AWS Bedrock Converse API |
| `web` | `fastapi` + `uvicorn` — local web dashboard |
| `messaging` | Telegram, Discord, aiohttp, Slack |
| `matrix` | mautrix + E2EE (Linux only) |
| `voice` | faster-whisper, sounddevice, numpy |
| `tts-premium` | elevenlabs |
| `rl` | atroposlib, tinker, fastapi, uvicorn, wandb |
| `termux` | Android-safe bundle (messaging, cron, cli, pty, mcp, honcho, acp) |
| `mcp` | mcp SDK |
| `modal` | Modal cloud execution |
| `daytona` | Daytona cloud workspaces |
| `honcho` | Honcho AI memory |
| `acp` | Agent Communication Protocol |
| `mistral` | mistralai SDK |
| `all` | All extras (excluding rl, yc-bench, termux) |

---

## Development & Usage

### Prerequisites

- Python 3.11+
- `uv` (recommended) or pip
- Node.js 20+ (WhatsApp bridge; web dashboard build)

### Setup

```bash
uv venv venv --python 3.11 && source venv/bin/activate
uv pip install -e ".[all,dev]"
cp .env.example ~/.hermes/.env   # add API keys
hermes setup                     # interactive wizard
```

### Running

```bash
hermes                           # interactive CLI
hermes gateway                   # messaging gateway (18 platforms)
hermes dashboard                 # web UI at http://127.0.0.1:9119
hermes mcp serve                 # MCP server (stdio, for Claude Desktop/Code)
hermes-agent                     # headless non-interactive agent
```

### Running Tests

```bash
python -m pytest tests/ -q                          # full suite (~3,000 tests, ~3 min)
python -m pytest tests/test_model_tools.py -q       # toolset resolution
python -m pytest tests/gateway/ -q                  # gateway tests
python -m pytest tests/tools/ -q                    # tool-level tests
python -m pytest -m integration                     # integration tests (need API keys)
```

Tests use `_isolate_hermes_home` autouse fixture — they never write to `~/.hermes/`.

### Building / Deploying

```bash
docker build -t hermes-agent .                # non-root container (Node 22)
nix build                                     # Nix package
hermes gateway install [--system]             # systemd service install
hermes gateway start / stop / restart         # service lifecycle
```

---

## Notable Patterns & Conventions

### File Dependency Chain

```
tools/registry.py  (no deps — imported by all tool files)
       ↑
tools/*.py         (each calls registry.register() at import)
       ↑
model_tools.py     (imports registry + triggers all tool discovery)
       ↑
run_agent.py, cli.py, batch_runner.py, environments/
```

Never import `model_tools.py` from tool files — circular import.

### Prompt Caching Discipline

System prompt (identity + memory + skills index + context files) built **once per session**, never mutated. Required for Anthropic prefix caching. Toolsets also frozen at session start. Context compression is the only permitted mid-conversation message-list mutation.

### COMMAND_REGISTRY Is the Single Source

All 42 slash commands defined in `hermes_cli/commands.py`. CLI dispatch, gateway routing, Telegram menus, Slack routing, autocomplete, and help text all derive from it automatically. Adding a command: one registry entry + handler method.

### `_last_resolved_tool_names` Is Process-Global

Tracks active tool names for dynamic schema injection in `model_tools.py`. `_run_single_child()` in `delegate_tool.py` saves/restores it around subagent execution.

### Activity-Based Timeouts

`_last_activity_ts` is touched on every tool call and heartbeat tick. Gateway inactivity monitor checks elapsed time against this timestamp, not wall clock. Long-running background tasks and delegate_task child activity both propagate heartbeats to the parent.

### Async Bridge in `model_tools.py`

Persistent per-thread event loops (not `asyncio.run()`, which closes the loop) preserve cached `httpx.AsyncClient` and `AsyncOpenAI` connections across repeated tool calls.

### Profile-Safe Paths

All `~/.hermes` access must go through `get_hermes_home()` in `hermes_constants.py`. `is_termux()`, `is_wsl()`, `is_container()` are also in constants for platform detection.

### No `simple_term_menu`

Rendering bugs in tmux/iTerm2. Use `curses` instead (see `hermes_cli/tools_config.py`).

### No `\033[K` in Display Code

Leaks as `?[K` under `prompt_toolkit`'s `patch_stdout`. Use space-padding: `f"\r{line}{' ' * pad}"`.

### Skins Are Pure Data

Add a theme via `_BUILTIN_SKINS` in `hermes_cli/skin_engine.py` or a YAML file in `~/.hermes/skins/`. No code changes needed.

---

## What Changed: v0.8.0 → v0.10.0

### v0.9.0 (April 13, 2026) — 487 commits, 269 PRs

**New Platforms:** BlueBubbles (iMessage), WeChat/Weixin, WeCom Callback → **18 platforms total**

**New Infrastructure:**
- Local web dashboard (React + TypeScript + FastAPI, `hermes dashboard`)
- `/steer <prompt>` — mid-run steering without interrupt
- `hermes debug share` — paste-bin debug reports
- `hermes backup` / `hermes import` — profile backup and restore
- Termux/Android native support (`[termux]` extra)
- Unified proxy support (SOCKS, DISCORD_PROXY, macOS system proxy auto-detect)
- Per-platform display verbosity configuration (`gateway/display_config.py`)
- `gateway/platforms/helpers.py` — extracted shared dedup/batching/thread-tracking patterns

**New Providers:** xAI/Grok, Xiaomi MiMo, Qwen OAuth, Voxtral TTS/STT (Mistral AI)

**Agent Loop:** Inactivity-based timeouts replacing wall-clock, staged inactivity warnings, child activity propagated to parent heartbeat, `/fast` mode for OpenAI Priority + Anthropic fast tier, background process `watch_patterns`, compression floor preventing mid-task abort

**Security (7 major fixes):** Twilio webhook HMAC validation (SMS RCE), shell injection in sandbox writes, git argument injection in checkpoint manager, SSRF redirect guards (Slack), API server key enforcement, approval button authorization, path traversal in skill manager

### v0.10.0 (April 16, 2026) — 180+ commits

**New:** Nous Tool Gateway — paid Portal subscribers get automatic web search (Firecrawl), image gen (FAL/FLUX 2 Pro), TTS (OpenAI), and browser automation (Browser Use) with no extra API keys

**New Provider Adapters:**
- `agent/bedrock_adapter.py` — AWS Bedrock Converse API (boto3, 5-source credential chain, inference profiles, guardrails)
- `agent/gemini_cloudcode_adapter.py` — Google Cloud Code Assist OAuth facade (free + paid tiers)
- `agent/google_code_assist.py` — Code Assist control-plane (tier detection, onboarding, `/gquota`)
- `agent/google_oauth.py` — PKCE S256 OAuth for Gemini CLI (cross-process locking, refresh rotation)
- `agent/nous_rate_guard.py` — Shared cross-session 429 cooldown state file

**Credential Pool:** Exhaustion TTL reduced 24h → 1h for both 429 and 402 errors

**Context Compressor:** Tool result pre-pruning with one-liner summaries, 2K–12K token budget range, iterative summary merging across multiple compactions
