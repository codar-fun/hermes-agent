# Hermes Agent - Design Document

**Version:** 0.7.0  
**Build System:** Python 3.11+ with setuptools  
**License:** MIT  
**Organization:** Nous Research

---

## Executive Summary

Hermes Agent is a self-improving AI agent with:
- A **unified conversation loop** (`AIAgent` in `run_agent.py`) that handles OpenAI-compatible LLM APIs with automatic tool calling
- **Multi-platform messaging gateway** supporting Telegram, Discord, Slack, WhatsApp, Signal, Matrix, DingTalk, Feishu, Email, WebHooks, Home Assistant, SMS, and API servers
- **Flexible toolsets system** enabling tool grouping and composition across CLI and all messaging platforms
- **Persistent session store** (SQLite + FTS5) for conversation history and full-text search
- **Built-in learning loop** with skill management, memory persistence, autonomous skill creation, and scheduled automations
- **Dynamic prompt assembly** with context files, user memory, skill suggestions, and security scanning
- **Model-agnostic design** supporting 200+ models across 10+ LLM providers with prompt caching and smart routing
- **Extensibility** via MCP protocol, custom skills, and terminal backend abstraction (local, Docker, SSH, Modal, Daytona, Singularity)

---

## 1. Core Components

### 1.1 Entry Points & Top-Level Orchestrators

| Component | File | Purpose |
|-----------|------|---------|
| **AIAgent** | `run_agent.py` (466 KB) | Main conversation loop — handles OpenAI-format messages, tool calling, and iteration budget. Synchronous, provider-agnostic. |
| **HermesCLI** | `cli.py` (380 KB) | Interactive terminal interface using Rich + prompt_toolkit. REPL with autocomplete, streaming output, and TUI layout. |
| **Messaging Gateway** | `gateway/run.py` (338 KB) | Async event loop for Telegram, Discord, Slack, WhatsApp, Signal, Matrix, DingTalk, Feishu, Email, Webhooks, Home Assistant. |
| **CLI Subcommands** | `hermes_cli/main.py` (222 KB) | Entry point `hermes` — routes to 30+ subcommands (model, tools, setup, skills, cron, profiles, etc.). |
| **Batch Runner** | `batch_runner.py` (55 KB) | Parallel trajectory generation for RL datasets and research. |

### 1.2 Agent System Architecture

#### **Agent Loop** (`run_agent.py`)

The core is entirely **synchronous**:

```python
while api_call_count < max_iterations and iteration_budget.remaining > 0:
    response = client.chat.completions.create(
        model=model,
        messages=messages,          # OpenAI format
        tools=tool_schemas,         # Dynamic toolset selection
        **provider_config           # Temperature, reasoning, etc.
    )
    if response.tool_calls:
        for tc in response.tool_calls:
            result = handle_function_call(tc.name, tc.args, task_id)
            messages.append({"role": "tool", "content": result, ...})
        api_call_count += 1
    else:
        return response.content
```

**Design decisions:**
- **Synchronous** for simplicity; async bridging via `model_tools._run_async()` for tools that need it
- **OpenAI format** adopted for compatibility with 200+ models across OpenRouter, Anthropic, custom endpoints
- **Tool schema versioning** — functions are always JSON strings (no Python objects passed to LLM)
- **Iteration budget** separate from max_iterations — prioritizes model tokens over API call count
- **Reasoning content** stored in `assistant_msg["reasoning"]` for extended-thinking models

**Key classes:**
- `AIAgent` — main orchestrator with session/memory/model setup
- `IterationBudget` — tracks tokens to prevent runaway conversations
- `ClientFactory` — abstracts provider-specific client construction
- `MessageCompactor` — detects/warns about approaching context limits

---

### 1.3 Tool System

#### **Tool Registry** (`tools/registry.py`)

Central catalog of all tool schemas and handlers:

```python
class ToolEntry:
    name: str              # "web_search"
    toolset: str           # "web", "core", etc.
    schema: dict           # OpenAI format
    handler: Callable      # Returns JSON string
    check_fn: Callable     # Availability check
    requires_env: [str]    # Required env vars
    is_async: bool         # Async handler?
    description: str
    emoji: str

class ToolRegistry:
    register(name, toolset, schema, handler, check_fn, ...) -> None
    get_tool(name) -> ToolEntry
    get_tools_in_toolset(toolset) -> [ToolEntry]
    dispatch(name, args) -> result  # Calls handler with async bridging
    deregister(name) -> None        # Used by MCP for dynamic updates
```

**Registration pattern:**

Each tool file (`tools/*.py`) self-registers at import time:

```python
# tools/web_search.py
registry.register(
    name="web_search",
    toolset="web",
    schema={
        "name": "web_search",
        "description": "Search the web with Exa",
        "parameters": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"]
        }
    },
    handler=web_search_handler,
    check_fn=lambda: bool(os.getenv("EXA_API_KEY")),
    requires_env=["EXA_API_KEY"],
    is_async=True,
    emoji="🔍"
)
```

**Tool discovery chain:**

```
tools/registry.py  (no deps)
    ↑
tools/*.py  (import registry, call register() at module level)
    ↑
model_tools.py  (imports registry + all tool modules)
    ↑
run_agent.py, cli.py, batch_runner.py, gateway/run.py
```

#### **Tool Handlers** (`tools/`)

| Tool | File | Purpose |
|------|------|---------|
| **Web Search & Extract** | `tools/browser_tool.py` (85 KB) | Browserbase automation + vision. Exa integration. |
| **Web Scraping** | `tools/file_tools.py` (38 KB) | Firecrawl extraction, Parallel-web fallback. |
| **Code Execution** | `tools/code_execution_tool.py` (52 KB) | Sandboxed Python/JS via custom pyenv + Docker/SSH/Modal backends. |
| **Terminal** | `tools/terminal_tool.py` (67 KB) | Shell execution, process management. Supports local/Docker/SSH/Modal/Daytona backends. |
| **File Operations** | `tools/file_operations.py` (45 KB) + `tools/file_tools.py` | read/write/patch/search files with safety checks. |
| **Vision** | `tools/vision_analyze.py` (implied in tool list) | Image analysis via auxiliary client routing. |
| **Image Generation** | `tools/image_generation_tool.py` (28 KB) | Fal.ai, DALL-E, Flux integration. |
| **MCP** | `tools/mcp_tool.py` (84 KB) | Model Context Protocol server discovery + tool wrapping. Handles OAuth flow. |
| **Skills** | `tools/skills_tool.py` (50 KB) | Skill lifecycle management (create, edit, execute, publish). |
| **Skills Hub** | `tools/skills_hub.py` (99 KB) | GitHub skills marketplace integration, install/uninstall. |
| **Memory** | `tools/memory_tool.py` (23 KB) | Memory manipulation (create, append, view memories). |
| **Session Search** | `tools/session_search_tool.py` (21 KB) | FTS5-backed conversation history search + LLM summarization. |
| **Browser** | `tools/browser_camofox.py` (20 KB) | Camoufox stealth browser + Agent-browser library. |
| **Approval** | `tools/approval.py` (35 KB) | Dangerous command detection + user sudo approval. |
| **Delegate** | `tools/delegate_tool.py` (36 KB) | Spawn isolated subagents with parallel execution. |
| **Cronjobs** | `tools/cronjob_tools.py` (19 KB) | Schedule recurring tasks with natural language. |
| **Home Assistant** | `tools/homeassistant_tool.py` (17 KB) | Smart home device control (list, get state, call services). |
| **Process Registry** | `tools/process_registry.py` (35 KB) | Background process tracking + cleanup. |
| **Mixture of Agents** | `tools/mixture_of_agents_tool.py` (23 KB) | Route complex queries to parallel expert agents. |
| **RL Training** | `tools/rl_training_tool.py` (57 KB) | Trajectory collection + Atropos RL environment integration. |
| **Send Message** | `tools/send_message_tool.py` (39 KB) | Cross-platform messaging delivery. Gated on gateway running. |

#### **Model Tools Orchestration** (`model_tools.py`)

Thin layer over registry providing public APIs:

```python
def get_tool_definitions(
    enabled_toolsets: list,
    disabled_toolsets: list,
    quiet_mode: bool = False
) -> list:
    """Return list of OpenAI tool schemas filtered by toolset + availability."""
    # Filters by toolset membership
    # Runs check_fn for each tool
    # Skips unavailable tools (missing env vars, unreachable services)
    # Returns filtered schema list for LLM

def handle_function_call(
    function_name: str,
    function_args: dict,
    task_id: str = None,
    user_task: str = None
) -> str:
    """Execute a tool and return JSON string result."""
    # Looks up tool in registry
    # Dispatches to handler with async bridging
    # Catches exceptions, returns error JSON

def get_toolset_for_tool(name: str) -> str:
    """Map tool name -> toolset."""

def check_toolset_requirements() -> dict:
    """Return {toolset: [missing_env_vars]} for incomplete toolsets."""

_get_tool_loop():
    """Persistent event loop for CLI async tools (prevents 'Event loop is closed')."""

_get_worker_loop():
    """Per-worker-thread loop for parallel tool execution."""
```

**Async bridging:**

Tool handlers may be async. `_run_async()` bridges sync → async:

1. **CLI thread (main):** Uses persistent `_tool_loop` (reused across calls)
2. **Worker threads (ThreadPoolExecutor):** Per-thread persistent loop in `_worker_thread_local`
3. **Async contexts (gateway):** Spawns disposable thread to avoid loop conflicts

---

### 1.4 Toolsets System

#### **Toolset Definitions** (`toolsets.py`)

Flexible grouping mechanism allowing tool organization for different scenarios:

```python
TOOLSETS = {
    "web": {
        "description": "Web research and content extraction",
        "tools": ["web_search", "web_extract"],
        "includes": []
    },
    "terminal": {
        "description": "Shell execution and process management",
        "tools": ["terminal", "process"],
        "includes": []
    },
    "code": {
        "description": "Code execution and development",
        "tools": ["execute_code", "vision_analyze"],
        "includes": ["file"]
    },
    # ... ~30 more toolsets
}

# Core tools available on all platforms
_HERMES_CORE_TOOLS = [
    "web_search", "web_extract", "terminal", "process",
    "read_file", "write_file", "patch", "search_files",
    "vision_analyze", "image_generate",
    "browser_navigate", "browser_snapshot", "browser_click",
    "browser_type", "browser_scroll", "browser_back",
    "browser_press", "browser_close", "browser_get_images",
    "browser_vision", "browser_console",
    "text_to_speech",
    "todo", "memory",
    "session_search",
    "clarify",
    "execute_code", "delegate_task",
    "cronjob",
    "send_message",
    "ha_list_entities", "ha_get_state", "ha_list_services", "ha_call_service"
]
```

**Resolution logic:**

```python
def resolve_toolset(toolset_name: str) -> set:
    """Recursively resolve toolset → all tool names (includes composition)."""

def validate_toolset(toolset_name: str) -> bool:
    """Check if toolset exists and all nested references are valid."""
```

**Design decisions:**
- Toolsets are **data-driven** (YAML/dict based, not code)
- Support **composition** via `includes` (e.g., `"full_stack"` includes `"web"`, `"code"`, `"terminal"`)
- **Per-platform customization** — each platform (CLI, Telegram, Discord, etc.) can have its own enabled toolsets
- **Dynamic filtering** — at runtime, tools are further filtered by `check_fn()` (env vars, service availability)

---

### 1.5 CLI System

#### **Interactive Interface** (`cli.py`)

Built with **prompt_toolkit** (fixed input area, streaming output):

```python
class HermesCLI:
    def __init__(self, config: dict, model: str, toolsets: list, ...):
        # Layout: banner + conversation history + fixed input line + help
        self.app = Application(
            layout=Layout(HSplit([
                Window(content=history_content),  # Scrollable conversation
                Window(content=input_area),        # Fixed input at bottom
            ])),
            key_bindings=self._setup_keybindings(),
        )
    
    def run_conversation(self, user_input: str):
        # Build system prompt (identity + memory + skills + context files)
        # Call AIAgent.run_conversation()
        # Render response with KawaiiSpinner animation
        # Update conversation history UI
    
    def process_command(self, command: str):
        # Dispatch on canonical command name from registry
        # Examples: /new, /retry, /model, /skills, /memory, etc.
```

**Keybindings:**
- `Ctrl+C` — interrupt current operation
- `Ctrl+D` / `/exit` — quit gracefully
- `Tab` — autocomplete slash commands + parameters
- `Alt+Enter` — multiline edit mode

**Skin/theme engine** (`hermes_cli/skin_engine.py`):

Pure **data-driven theming** — no code changes to add new skins:

```yaml
# ~/.hermes/skins/myTheme.yaml
spinner_frames: ["🌙", "⭐"]
spinner_verbs: ["thinking", "dreaming"]
spinner_wings: "✨"
banner_color: "cyan"
tool_prefix: "▸"
response_box_style: "rounded"
prompt_text: "You >"
```

Skins are loaded from:
1. Builtin skins in `hermes_cli/skin_engine.py` (`_BUILTIN_SKINS`)
2. User skins in `~/.hermes/skins/*.yaml`

Activated via `/skin <name>` or `display.skin: <name>` in config.

---

#### **Slash Command System** (`hermes_cli/commands.py`)

Central registry of all slash commands:

```python
@dataclass
class CommandDef:
    name: str                      # canonical (no slash)
    description: str               # human-readable
    category: str                  # "Session", "Configuration", etc.
    aliases: tuple = ()            # alternative names
    args_hint: str = ""            # "[model]", "[days]", etc.
    cli_only: bool = False         # unavailable in gateway?
    gateway_only: bool = False     # unavailable in CLI?
    gateway_config_gate: str = ""  # config dotpath for conditional availability

COMMAND_REGISTRY = [
    CommandDef("new", "Start a fresh conversation", "Session", aliases=("reset",)),
    CommandDef("model", "Switch LLM provider/model", "Configuration", args_hint="[provider:model]"),
    CommandDef("skills", "Browse and manage skills", "Tools & Skills", aliases=("skill",)),
    CommandDef("tools", "Enable/disable tools", "Configuration", cli_only=True),
    # ... ~30 more
]

# Downstream consumers all derive from this registry:
COMMANDS = {name: CommandDef for name, cmd_def in COMMAND_REGISTRY}       # Flat dict
COMMANDS_BY_CATEGORY = {cat: [cmd_def]}                                    # CLI help
GATEWAY_KNOWN_COMMANDS = frozenset([cmd.name for cmd in COMMAND_REGISTRY]) # Gateway dispatch
```

**Adding a new slash command:**

1. Add `CommandDef` to `COMMAND_REGISTRY` in `hermes_cli/commands.py`
2. Add handler in `HermesCLI.process_command()` in `cli.py`
3. (Optional) Add handler in `gateway/run.py` if not CLI-only
4. Aliases automatically propagate — no extra work needed

**Adding an alias:**

Just add to the `aliases` tuple — dispatch, help, Telegram menus, Slack routing, autocomplete all update automatically.

---

#### **Config System** (`hermes_cli/config.py`)

Two separate loaders with different purposes:

```python
# CLI config (run_agent.py, cli.py)
def load_cli_config() -> dict:
    """Load from ~/.hermes/config.yaml with hardcoded defaults."""
    # Reads YAML
    # Merges with DEFAULT_CONFIG (defines all options + descriptions)
    # Returns flat dict

DEFAULT_CONFIG = {
    "model": {"provider": "anthropic", "name": "claude-opus-4-20250514"},
    "temperature": 0.7,
    "max_iterations": 90,
    "memory": {"enabled": True, "summarization": "enabled"},
    "display": {"skin": "default", "tool_progress": "enabled"},
    "tools": {"enabled": ["web", "terminal"], "disabled": []},
    "skills": {"enabled": [], "disabled": []},
    # ... 100+ keys
}

# Gateway/subcommand config (hermes_cli/main.py, gateway/run.py)
def load_config(profile: str = None) -> dict:
    """Load from ~/.hermes/config.yaml + provider credentials."""
    # Different from CLI config — used by `hermes setup`, `hermes tools`, gateway

_config_version = 42  # Bumped on schema changes; triggers auto-migration
```

**Config storage:**
- **Settings:** `~/.hermes/config.yaml` (YAML, user-edited)
- **API keys:** `~/.hermes/.env` (DotEnv, sensitive)
- **Auth tokens:** `~/.hermes/auth.json` (JSON, OAuth provider tokens)

**Profile support** (`HERMES_HOME` env var):

```bash
HERMES_HOME=~/.hermes/profiles/work hermes  # Isolated profile
hermes config set --profile work model.provider openrouter
```

---

### 1.6 Memory & Session System

#### **Session Store** (`hermes_state.py`)

SQLite with WAL mode for concurrent readers + one writer:

```python
# Schema: 
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    source TEXT,                   # "cli", "telegram", "discord", etc.
    user_id TEXT,
    model TEXT,
    system_prompt TEXT,
    parent_session_id TEXT,        # For compression chains
    started_at REAL,
    ended_at REAL,
    message_count INTEGER,
    tool_call_count INTEGER,
    input_tokens, output_tokens, cache_read_tokens, ...,
    estimated_cost_usd, actual_cost_usd,
    title TEXT,
    FOREIGN KEY (parent_session_id) REFERENCES sessions(id)
);

CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    session_id TEXT,
    role TEXT,                     # "user", "assistant", "tool"
    content TEXT,
    tool_call_id TEXT,
    tool_calls TEXT,               # JSON
    tool_name TEXT,
    timestamp REAL,
    token_count INTEGER,
    reasoning TEXT,                # Extended thinking
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE VIRTUAL TABLE messages_fts USING fts5(
    content,
    content=messages,
    content_rowid=id
);  # Full-text search
```

**Key features:**
- **FTS5 search** — fast full-text search across all sessions
- **Session chains** — `parent_session_id` for compression-triggered splits
- **Cost tracking** — input/output/cache tokens + estimated cost per provider
- **WAL mode** — allows gateway multi-platform writes + CLI reads simultaneously
- **Source tagging** — filter by platform ("cli", "telegram", "discord", etc.)

**Session class:**

```python
class SessionDB:
    def __init__(self, db_path: Path):
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.execute("PRAGMA journal_mode=WAL")
    
    def create_session(self, session_id, source, model, system_prompt) -> None:
    def save_message(self, session_id, role, content, tool_info, tokens) -> None:
    def get_session_messages(self, session_id) -> list:
    def search_sessions(self, query: str, limit: int = 10) -> list:
    def update_cost(self, session_id, input_tokens, output_tokens, cost) -> None:
```

#### **Memory Manager** (`agent/memory_manager.py`)

Builds memory context block injected into system prompt:

```python
def build_memory_context_block(
    memory_dir: Path,
    user_id: str,
    platform: str,
    max_tokens: int
) -> str:
    """Load and format MEMORY.md, USER.md, SOUL.md files."""
    # Reads files from ~/.hermes/memory/
    # Scans for prompt injection threats
    # Truncates to fit token budget
    # Returns formatted markdown block
```

**Memory files:**
- `MEMORY.md` — procedural memory (facts, skills, past decisions)
- `USER.md` — user profile (preferences, background, context)
- `SOUL.md` — system personality/identity

---

### 1.7 Prompt System

#### **Prompt Builder** (`agent/prompt_builder.py`)

Assembles system prompt from modular components:

```python
class PromptBuilder:
    def build_system_prompt(
        self,
        platform: str,
        memory_block: str,
        skills_index: str,
        context_files: str,
        model: str
    ) -> str:
        """Assemble final system prompt."""
        return "\n\n".join([
            DEFAULT_AGENT_IDENTITY,
            PLATFORM_HINTS.get(platform, ""),
            memory_block,
            MEMORY_GUIDANCE,
            skills_index,
            SESSION_SEARCH_GUIDANCE,
            context_files,
            TOOL_USE_ENFORCEMENT_GUIDANCE,  # If applicable to model
            GOOGLE_MODEL_OPERATIONAL_GUIDANCE,  # If Google model
            OPENAI_MODEL_EXECUTION_GUIDANCE,  # If OpenAI model
        ])
```

**Components:**

| Component | Purpose |
|-----------|---------|
| `DEFAULT_AGENT_IDENTITY` | Core personality (helpful, self-improving, skill creation) |
| `PLATFORM_HINTS[platform]` | Platform-specific guidance (e.g., "you're in Telegram, keep messages concise") |
| `MEMORY_GUIDANCE` | Instructions for memory usage (when/how to update memories) |
| `SESSION_SEARCH_GUIDANCE` | Hints for using session_search tool |
| `SKILLS_GUIDANCE` | Index of available skills with descriptions + parameters |
| Context files | `AGENTS.md`, `.cursorrules`, project context |
| Model-specific guidance | Tool use enforcement, extended thinking guidance |

**Context file scanning** (`agent/prompt_builder.py`):

Scans for prompt injection before loading context files:

```python
_CONTEXT_THREAT_PATTERNS = [
    r'ignore\s+(previous|all|above|prior)\s+instructions',
    r'do\s+not\s+tell\s+the\s+user',
    r'system\s+prompt\s+override',
    # ... 10+ patterns
]

_CONTEXT_INVISIBLE_CHARS = {
    '\u200b', '\u200c', '\u200d',  # Zero-width chars
    '\u202a', '\u202b', '\u202c',  # Direction override chars
}

def _scan_context_content(content: str, filename: str) -> str:
    """Detect and block injection attempts."""
    # Checks for invisible unicode
    # Checks for threat patterns (case-insensitive regex)
    # Returns sanitized content or [BLOCKED] message
```

---

### 1.8 Context Compression

#### **Automatic Context Management** (`agent/context_compressor.py`)

Detects approaching context limits and automatically compresses mid-conversation:

```python
class ContextCompressor:
    def __init__(
        self,
        model: str,
        threshold_percent: float = 0.50,  # Trigger at 50% capacity
        protect_first_n: int = 3,         # Keep head messages
        protect_last_n: int = 20,         # Keep tail by token budget
        summary_target_ratio: float = 0.20,
        quiet_mode: bool = False
    ):
        self.model = model
        self.threshold_percent = threshold_percent

    def check_and_compress(
        self,
        messages: list,
        token_estimates: dict,
        client,
        task_id: str = None
    ) -> (list, str):
        """Check if compression needed; if so, compress messages + return summary."""
        # Estimates tokens for current messages
        # If >= threshold_percent * context_limit:
        #   1. Prune old tool results (cheap, no LLM call)
        #   2. Protect head + tail messages
        #   3. Summarize middle with structured LLM prompt
        #   4. Return compressed messages + summary text
        # Else:
        #   Return (messages, "")  # No compression needed
```

**Compression algorithm:**

1. **Tool result pruning** (cheap) — replaces old tool results with `[Old tool output cleared]`
2. **Protect head** — system prompt + first N exchanges
3. **Protect tail** — most recent ~20K tokens (recent work)
4. **Summarize middle** — asks auxiliary LLM to produce structured summary:
   - Goal (what were we trying to achieve?)
   - Progress (what did we accomplish?)
   - Decisions (key decisions made)
   - Files (what files were created/modified)
   - Next Steps (what comes next)

**Iterative updates:**

On subsequent compressions, the LLM updates the previous summary instead of creating a new one — preserves information across multiple compactions.

**Design decisions:**
- **Threshold-based** — only compress when necessary (saves auxiliary LLM calls)
- **Token-budget tail protection** — not fixed message count (recent work is longer than old work)
- **Structured summary** — easier for model to extract actionable info
- **Auxiliary model** — uses cheap/fast model for summarization (not main model)

---

## 2. Messaging Gateway

### 2.1 Gateway Architecture

#### **Main Loop** (`gateway/run.py`)

Async event loop handling all platform adapters:

```python
class MessagingGateway:
    async def start(self):
        # Load platform configs from ~/.hermes/config.yaml
        # Initialize adapters (Telegram, Discord, Slack, etc.)
        # For each adapter:
        #   - Create message listener task
        #   - Create delivery handler task
        # Run all tasks concurrently
        
    async def handle_message(self, event: MessageEvent):
        # Extract user message from platform event
        # Check permission (DM pairing, command approval)
        # Call AIAgent.run_conversation()
        # Format response for target platform
        # Call deliver()
    
    async def deliver(self, user_id, message, platform):
        # Route to platform adapter
        # Handle rate limiting
        # Retry on transient failure
```

**Platform adapters** (`gateway/platforms/`):

Each platform has a base class + concrete implementation:

```python
class PlatformAdapter(ABC):
    async def start(self):
        """Start listening for messages."""
    
    async def send_message(self, user_id: str, message: str):
        """Deliver message to user on this platform."""
    
    async def handle_inline_message(self, user_id: str, message: str):
        """Handle interrupt/new message during agent execution."""

# Concrete implementations:
class TelegramAdapter(PlatformAdapter): ...
class DiscordAdapter(PlatformAdapter): ...
class SlackAdapter(PlatformAdapter): ...
class WhatsAppAdapter(PlatformAdapter): ...
class SignalAdapter(PlatformAdapter): ...
class MatrixAdapter(PlatformAdapter): ...
class EmailAdapter(PlatformAdapter): ...
class HomeAssistantAdapter(PlatformAdapter): ...
```

| Platform | File | Features |
|----------|------|----------|
| **Telegram** | `gateway/platforms/telegram.py` (99 KB) | BotCommand menus, inline buttons, file uploads, voice memos |
| **Discord** | `gateway/platforms/discord.py` (108 KB) | Rich embeds, reactions, thread support, cog-based architecture |
| **Slack** | `gateway/platforms/slack.py` (39 KB) | Block Kit formatting, slash commands, app mentions |
| **WhatsApp** | `gateway/platforms/whatsapp.py` (40 KB) | Twilio/official API, group support, media handling |
| **Signal** | `gateway/platforms/signal.py` (31 KB) | Signal CLI bridge, end-to-end encryption |
| **Matrix** | `gateway/platforms/matrix.py` (81 KB) | E2E encryption, threads, rich formatting |
| **Email** | `gateway/platforms/email.py` (23 KB) | IMAP/SMTP, multipart MIME, attachment handling |
| **Home Assistant** | `gateway/platforms/homeassistant.py` (16 KB) | Device control, state queries, service calls |
| **DingTalk** | `gateway/platforms/dingtalk.py` (13 KB) | Enterprise messaging, bot commands |
| **Feishu** | `gateway/platforms/feishu.py` (137 KB) | Rich cards, message replies, image uploads |
| **WeChat Work** | `gateway/platforms/wecom.py` (53 KB) | QR code login, group support, markdown formatting |
| **SMS** | `gateway/platforms/sms.py` (10 KB) | Twilio SMS integration, text-only |
| **Webhooks** | `gateway/platforms/webhook.py` (23 KB) | Generic HTTP webhook listener (custom integrations) |
| **API Server** | `gateway/platforms/api_server.py` (67 KB) | FastAPI server for programmatic access |
| **Mattermost** | `gateway/platforms/mattermost.py` (31 KB) | Slack-compatible protocol |

#### **Session Persistence** (`gateway/session.py`)

Gateway-specific session management (separate from CLI sessions):

```python
class GatewaySessionStore:
    def __init__(self, db_path: Path):
        self.conn = sqlite3.connect(db_path)
    
    def get_or_create_session(self, user_id: str, platform: str) -> Session:
        """Get active session or create new one."""
    
    def archive_session(self, session_id: str) -> None:
        """Mark session as ended."""
    
    def get_user_sessions(self, user_id: str, platform: str) -> list:
        """Retrieve conversation history for user."""
```

#### **Delivery System** (`gateway/delivery.py`)

Async message delivery with retry + rate limiting:

```python
class Delivery:
    async def send(
        self,
        platform: str,
        user_id: str,
        message: str,
        attempts: int = 3,
        backoff_seconds: int = 1
    ) -> bool:
        """Send message with exponential backoff on failure."""
```

---

### 2.2 Gateway Features

#### **Platform-Independent Slash Commands**

All slash commands from CLI also work in gateway (with platform-specific formatting):

```
/new                         # Start fresh conversation
/model anthropic:claude-opus  # Switch model
/skills                       # Browse skills
/memory TOPIC: "my notes"     # Update memory
/session_search "past work"   # Search conversation history
```

**Slash command routing:**

1. **Telegram** — BotCommand menu auto-generated from `COMMAND_REGISTRY`
2. **Slack** — `/hermes <subcommand>` routing via slash command handler
3. **Discord** — Slash command app commands registered with Discord
4. **Others** — Text parsing (message starts with `/`)

#### **Permission & Safety**

- **DM pairing** — Users must pair their account before first use
- **Command approval** — Dangerous commands (shell execution) require sudo approval
- **Rate limiting** — Per-user, per-platform message throttling

#### **Delivery Hooks** (`gateway/hooks.py`)

Built-in hooks for message preprocessing:

```python
def register_hook(event_type: str, handler: Callable):
    """Register handler for hook event."""

# Hook events:
# - "before_send" — modify message before delivery
# - "after_send" — log delivery, update metrics
# - "user_paired" — new user paired
# - "command_rejected" — command approval denied
```

---

## 3. Skills System

### 3.1 Skills Lifecycle

Skills are **procedural memory** — learned capabilities that improve over time.

#### **Skill Structure** (`~/.hermes/skills/<category>/<name>/`)

```
github-auth/
├── index.md           # Metadata (description, tags, version)
├── main.md            # Main skill definition (instructions, context)
├── check.py           # Availability check (optional)
└── scripts/           # Helper scripts (optional)
    └── auth_helper.py
```

**index.md** — Metadata:

```yaml
---
name: github-auth
category: software-development
description: Authenticate with GitHub using OAuth flow
tags: [authentication, github, oauth]
platforms: [cli, telegram, discord]
version: 1.0.0
parameters:
  username: GitHub username
  app_name: OAuth app name
---
```

**main.md** — Skill definition:

```markdown
# GitHub Auth Skill

Instructions for the agent to use this skill...

## Step 1: Get User Input
Ask the user for their GitHub username.

## Step 2: Launch OAuth
Call the auth endpoint and present the URL.

## Step 3: Verify
Poll for successful authentication.
```

#### **Skill Management** (`tools/skills_tool.py`)

```python
def skill_list(toolset: str = None, enabled_only: bool = False) -> str:
    """List all skills, optionally filtered."""

def skill_view(name: str) -> str:
    """View skill definition."""

def skill_create(
    name: str,
    category: str,
    description: str,
    template: str = "default"
) -> str:
    """Create new skill from template."""

def skill_edit(name: str, changes: str) -> str:
    """Modify existing skill (append, replace section)."""

def skill_execute(name: str, parameters: dict = None) -> str:
    """Execute skill with parameters."""

def skill_publish(name: str, meta: dict = None) -> str:
    """Publish to Skills Hub for community."""
```

### 3.2 Skills Hub Integration

#### **Skills Hub** (`tools/skills_hub.py`)

Integration with agentskills.io marketplace:

```python
class SkillsHub:
    def search(self, query: str, limit: int = 10) -> list:
        """Search marketplace for skills."""
    
    def install(self, skill_name: str, version: str = None) -> bool:
        """Download and install skill from hub."""
    
    def publish(self, skill_path: Path, metadata: dict) -> bool:
        """Publish skill to hub (requires GitHub App JWT)."""
```

**Feature flags:**

- **Bot identity** — optional GitHub App JWT for identity (allows publishing under `@hermes-agent`)
- **Version management** — fetch + install specific versions
- **Dependency resolution** — install skill's dependencies automatically

---

## 4. Skill Generation & Autonomous Improvement

### 4.1 Skill Auto-Creation

After complex multi-step tasks, agent can autonomously create skills:

```python
# In run_agent.py after task completion:
if should_create_skill(task_description, tool_calls, messages):
    skill = create_skill_from_trajectory(
        name=inferred_skill_name,
        description=task_description,
        steps=extract_steps(messages),
        category=infer_category(tool_calls)
    )
    skill.save()
    agent.nudge_memory(f"Created skill: {name}")
```

### 4.2 Skill Improvement

Skills evolve through use:

- **Execution feedback** — agent runs skill, notes successes/failures
- **Iterative refinement** — agent modifies skill instructions based on failures
- **Cross-session learning** — memory captures which skills worked well together

---

## 5. Scheduled Automations

### 5.1 Cron System

#### **Scheduler** (`cron/scheduler.py`)

Background scheduler for recurring tasks:

```python
class CronScheduler:
    def add_job(
        self,
        name: str,
        schedule: str,           # "0 9 * * *" (cron format)
        task: str,               # Natural language task
        delivery: str = "cli",   # Where to send output
        enabled: bool = True
    ) -> None:
        """Schedule a new cron job."""
    
    def list_jobs(self) -> list:
        """List all scheduled jobs."""
    
    def run_job(self, job_id: str) -> str:
        """Execute job immediately."""
    
    def delete_job(self, job_id: str) -> None:
        """Remove scheduled job."""

    async def start(self):
        """Main scheduler loop (runs in background)."""
        while True:
            jobs_due = self.get_jobs_due_now()
            for job in jobs_due:
                result = await self.execute_job(job)
                await self.deliver(job.delivery, result)
            await asyncio.sleep(60)  # Check every minute
```

#### **Job Execution** (`cron/jobs.py`)

Jobs are just prompts executed by AIAgent:

```python
class CronJob:
    def __init__(self, job_id, name, schedule, task_prompt):
        self.job_id = job_id
        self.name = name
        self.schedule = schedule  # e.g., "0 9 * * *"
        self.task_prompt = task_prompt
        self.last_run = None
        self.next_run = self.calculate_next_run()
    
    async def execute(self, agent: AIAgent) -> str:
        """Run the task via AIAgent."""
        result = agent.chat(self.task_prompt)
        self.last_run = datetime.now()
        self.next_run = self.calculate_next_run()
        return result
```

**Storage:**

- **Job definitions** — `~/.hermes/cron/jobs.yaml`
- **Execution history** — `~/.hermes/state.db` (separate table)

---

## 6. Model Support & Routing

### 6.1 Provider Abstraction

#### **Model Metadata** (`agent/model_metadata.py`)

Catalog of 200+ models across providers with context length + pricing:

```python
MODEL_METADATA = {
    "anthropic/claude-opus-4-20250514": {
        "context_limit": 200000,
        "pricing": {
            "input_tokens": 0.003,
            "output_tokens": 0.015,
            "cache_write": 0.00375,
            "cache_read": 0.0003
        },
        "capabilities": ["tool_calling", "vision", "extended_thinking"]
    },
    "openai/gpt-4o": {...},
    "openrouter/nvidia/nv-mixtral": {...},
    # ... 200+ models
}

def get_model_context_length(model: str, config_override: int = None) -> int:
    """Get context limit for model (with user config override)."""

def estimate_tokens_rough(text: str) -> int:
    """Fast token estimate (chars / 4)."""

def estimate_messages_tokens_rough(messages: list, model: str) -> int:
    """Estimate total tokens for message list."""
```

#### **Provider Clients** (`agent/anthropic_adapter.py`, `agent/models_dev.py`)

Factory pattern for creating provider-specific clients:

```python
class ClientFactory:
    @staticmethod
    def create_client(
        model: str,
        provider: str = "auto",  # Auto-detect from model slug
        base_url: str = None,
        api_key: str = None,
        **kwargs
    ) -> client:
        """Create provider-appropriate client (OpenAI, Anthropic, etc.)."""
        if model.startswith("anthropic/"):
            return Anthropic(api_key=api_key)
        elif model.startswith("openai/"):
            return OpenAI(api_key=api_key)
        elif model.startswith("openrouter/"):
            return OpenAI(base_url=OPENROUTER_BASE_URL, api_key=api_key)
        # ... more providers
```

#### **Anthropic Adapter** (`agent/anthropic_adapter.py`)

Specialized handling for Anthropic models (extended thinking, caching):

```python
class AnthropicAdapter:
    def prepare_request(
        self,
        messages: list,
        tools: list,
        reasoning_effort: str = None,
        **kwargs
    ) -> dict:
        """Prepare request for Anthropic API."""
        # Apply prompt caching control blocks
        # Add extended thinking params
        # Format tool definitions for Anthropic
        # Return request dict
```

#### **Prompt Caching** (`agent/prompt_caching.py`)

Reduces costs for repeated prompts (Anthropic):

```python
def apply_anthropic_cache_control(
    messages: list,
    system_prompt: str,
    model: str
) -> dict:
    """Add cache_control blocks to system prompt + head messages."""
    # Protect system prompt (doesn't change mid-conversation)
    # Protect initial messages (don't change during retries)
    # Mark tail as ephemeral (changes on each call)
    return {
        "system": [
            {"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}},
            # ... protected messages
        ]
    }
```

---

### 6.2 Smart Model Routing

#### **Routing Strategies** (`agent/smart_model_routing.py`)

Automatic model selection based on task characteristics:

```python
class SmartRouter:
    def select_model(
        self,
        task: str,
        user_model: str = None,
        force_reasoner: bool = False
    ) -> str:
        """Select best model for task."""
        # If user specified model, use it
        # If task requires reasoning (math, code), pick reasoner
        # If task is simple, pick cheap/fast model
        # Otherwise use user's default
        return selected_model
```

---

## 7. Advanced Features

### 7.1 Context Awareness

#### **Context Files**

Projects can include context files to shape agent behavior:

```
.cursorrules         # Cursor-compatible rules
AGENTS.md            # Workspace instructions
.hermes/AGENTS.md    # Hermes-specific workspace config
```

Files are scanned for prompt injection, then injected into system prompt.

#### **Subdirectory Hints** (`agent/subdirectory_hints.py`)

For large projects, agent learns which subdirectories are most relevant:

```python
class SubdirectoryHintTracker:
    def update(self, cwd: str, accessed_path: str):
        """Record which directories were accessed."""
    
    def get_hints(self) -> str:
        """Return directory relevance hints for next call."""
```

### 7.2 Vision & Image Generation

#### **Vision Analysis**

Routed through auxiliary client for flexibility:

```python
def vision_analyze(image_paths: list, query: str) -> str:
    """Analyze images using best available vision model."""
    # Routes via auxiliary_client resolution
    # Supports image URLs + local paths
    # Returns structured analysis
```

#### **Image Generation** (`tools/image_generation_tool.py`)

Multiple providers:

```python
def image_generate(
    prompt: str,
    model: str = "flux-pro",  # or "dall-e-3", "black-forest"
    size: str = "1024x1024",
    num_images: int = 1
) -> str:
    """Generate images."""
    # Routes via Fal.ai, DALL-E, Flux API
    # Returns image URLs
```

### 7.3 MCP Protocol Integration

#### **MCP Tool** (`tools/mcp_tool.py`)

Dynamically load tools from MCP servers:

```python
class MCPTool:
    def __init__(self, server_config: dict):
        self.server = MCPClient(server_config)
        self.tools = {}
    
    async def discover_tools(self):
        """Call list_tools on MCP server."""
        tool_definitions = await self.server.call_tool("tools/list")
        self.tools = {t["name"]: t for t in tool_definitions}
        self.register_with_hermes()
    
    async def call_tool(self, name: str, args: dict) -> str:
        """Forward tool call to MCP server."""
```

**OAuth flow** (`tools/mcp_oauth.py`):

Some MCP servers require OAuth (e.g., Google Workspace). Handles the flow:

```python
async def oauth_flow(server_name: str, client_id: str, client_secret: str):
    """Launch browser, get authorization, exchange for token."""
    # Opens browser for user consent
    # Starts local HTTP server to catch redirect
    # Exchanges code for token
    # Stores token in ~/.hermes/auth.json
```

### 7.4 Mixture of Agents (MoA)

#### **Expert Delegation** (`tools/mixture_of_agents_tool.py`)

Route complex queries to parallel specialist agents:

```python
def mixture_of_agents(
    query: str,
    experts: list = ["researcher", "coder", "analyst"]
) -> str:
    """Call multiple subagents in parallel, aggregate results."""
    # Spawns subagents with specialized system prompts
    # Each agent calls expert_model (fast/cheap)
    # Aggregates results with best_model
    # Returns comprehensive response
```

---

## 8. Extensibility & Customization

### 8.1 Plugin System

#### **Memory Plugins** (`plugins/memory/`)

Pluggable memory backends:

```
plugins/memory/
├── honcho/           # Dialectic user modeling (plastic-labs/honcho)
├── mem0/             # Mem0 integration
├── openviking/       # OpenViking embeddings
├── holographic/      # In-memory holographic storage
└── hindsight/        # Hindsight framework
```

Each plugin implements:

```python
class MemoryPlugin:
    async def initialize(self):
        """Setup plugin (load models, connect to service)."""
    
    async def store(self, key: str, value: str):
        """Store memory entry."""
    
    async def retrieve(self, query: str) -> list:
        """Retrieve relevant memories."""
    
    async def update(self, key: str, value: str):
        """Update existing memory."""
```

### 8.2 ACP Server (VS Code / Zed / JetBrains)

#### **ACP Adapter** (`acp_adapter/`)

Integrates Hermes with code editors via Agent Client Protocol:

```python
class ACPServer:
    async def start(self, port: int = 5007):
        """Start ACP server on port."""
        # Opens WebSocket for editor connections
        # Handles resource access (files, etc.)
        # Executes tools in editor context
    
    async def handle_tool_call(self, tool: str, args: dict):
        """Call Hermes tool from editor."""
        # Uses same tool registry
        # Returns results to editor
        # Updates editor UI with progress
```

**Features:**
- Read/write files in editor workspace
- Execute terminal commands in workspace
- Stream tool output to editor
- Show approval dialogs

---

## 9. Data Flow & Design Patterns

### 9.1 Message Flow (CLI)

```
User input (prompt_toolkit)
    ↓
HermesCLI.run_conversation()
    ↓
Build system prompt (identity + memory + skills + context files)
    ↓
AIAgent.run_conversation()
    ↓
ClientFactory.create_client(model, provider)
    ↓
client.chat.completions.create()
    ↓ (receives response with tool_calls)
handle_function_call(tool_name, tool_args)
    ↓
tools/registry.dispatch(tool_name, ...)
    ↓
tool handler (may be async, run via _run_async())
    ↓
return JSON result
    ↓ (loop back to LLM with tool_result message)
until no tool_calls
    ↓
KawaiiSpinner animation
    ↓
Rich formatting of response
    ↓
Display in prompt_toolkit window
```

### 9.2 Message Flow (Gateway)

```
Platform event (Telegram update, Discord message, etc.)
    ↓
PlatformAdapter.handle_message()
    ↓
MessagingGateway.handle_message()
    ↓
Permission check (DM pairing, approval)
    ↓
AIAgent.run_conversation()  (same as CLI)
    ↓
Format response for platform
    ↓
MessagingGateway.deliver()
    ↓
PlatformAdapter.send_message()
    ↓
Platform API (Telegram API, Discord API, etc.)
```

### 9.3 Tool Calling Architecture

```
Tool registry (tools/registry.py)
    ↑
    | (register() at import time)
    |
tools/*.py (each tool file)
    ↑
    | (import all tools)
    |
model_tools.py
    | get_tool_definitions()
    | handle_function_call()
    | check_tool_availability()
    ↑
    | (consume API)
    |
run_agent.py, cli.py, gateway/run.py, batch_runner.py
```

### 9.4 Async Bridging Pattern

```
Tool handler signature:
    - Sync: def tool(...) -> str
    - Async: async def tool(...) -> str

Dispatch logic:
    if tool.is_async:
        result = _run_async(tool_coro())
    else:
        result = tool(...)

_run_async() logic:
    if is_running_event_loop():
        # (e.g., gateway)
        return run_in_new_thread(asyncio.run(coro))
    else:
        # (e.g., CLI main thread)
        return _get_tool_loop().run_until_complete(coro)
```

### 9.5 Configuration Override Pattern

```
Hardcoded defaults
    ↑ (merged with)
~/.hermes/config.yaml
    ↑ (env vars override)
HERMES_MODEL, HERMES_TEMPERATURE, etc.
    ↑ (method params override)
AIAgent.__init__(model="...", ...)
```

---

## 10. Testing & Quality Assurance

### 10.1 Test Organization

```
tests/
├── agent/          # AIAgent, prompt building, memory
├── tools/          # Tool handlers, registry
├── gateway/        # Platform adapters, session store
├── hermes_cli/     # Config, commands, setup
├── skills/         # Skill management
├── cron/           # Scheduler
├── acp/            # ACP server
├── integration/    # End-to-end tests
├── fakes/          # Mock clients + responses
└── conftest.py     # Fixtures (3000+ tests)
```

**Test suite:** ~3000 tests, ~3 min runtime

```bash
python -m pytest tests/ -q              # Full suite
python -m pytest tests/test_model_tools.py -q  # Toolset tests
python -m pytest tests/test_cli_init.py -q     # Config tests
python -m pytest tests/gateway/ -q             # Gateway tests
```

### 10.2 Key Testing Patterns

- **Profile isolation** — tests mock `Path.home()` + set `HERMES_HOME` env var
- **Async testing** — `pytest-asyncio` for async test functions
- **Parallel execution** — `pytest-xdist` with `-n auto`
- **Mock clients** — `fakes/` directory for OpenAI/Anthropic mock responses

---

## 11. Security & Safety

### 11.1 Prompt Injection Prevention

```
Context files → scan for threat patterns + invisible chars
Skills descriptions → scanned before rendering to user
User memory → scanned before injection into prompt
Tool outputs → JSON-serialized (not raw strings)
```

### 11.2 Command Approval

Dangerous commands (shell execution, file deletion) require user approval:

```python
class ApprovalTool:
    def check_command(self, command: str) -> (bool, str):
        """Detect dangerous commands."""
        # Regex patterns for:
        # - Deletion (rm, del, unlink, shred)
        # - System modification (sudo, chmod, chown, passwd)
        # - Data exfiltration (curl | base64, scp, etc.)
        # Returns (is_dangerous, reason)

    async def get_approval(self, command: str) -> bool:
        """Ask user for sudo approval."""
```

### 11.3 API Key Management

- **Credential pool** (`agent/credential_pool.py`) — loads from `~/.hermes/.env` + env vars
- **Per-provider auth** (`hermes_cli/auth.py`) — OAuth flows for each provider
- **Secure storage** — DotEnv format, user-only file permissions

### 11.4 DM Pairing (Gateway)

First-time gateway users must pair their account:

```python
def pair_user(platform: str, user_id: str) -> (str, str):
    """Generate pairing code, store in DB."""
    # Returns (display_code, db_record)
    # User sends pairing code back
    # Agent verifies code matches
    # User is marked as paired
```

---

## 12. Deployment & Operations

### 12.1 Entry Points

```
hermes                  # CLI (from pyproject.toml: hermes_cli.main:main)
hermes-agent           # Standalone agent (run_agent:main)
hermes-acp             # ACP server (acp_adapter.entry:main)
hermes gateway         # Start messaging gateway
hermes model           # Switch LLM provider/model
hermes tools           # Enable/disable tools
hermes setup           # Interactive setup wizard
hermes cron            # Manage scheduled tasks
hermes profiles        # Manage profiles
hermes skills          # Manage skills
```

### 12.2 Docker Deployment

```dockerfile
FROM python:3.11-slim
RUN apt-get update && apt-get install -y git
WORKDIR /app
COPY . /app
RUN pip install -e ".[all]"
ENTRYPOINT ["hermes"]
```

### 12.3 Environment Variables

Key env vars (complete list in `hermes_cli/config.py`):

```
HERMES_HOME                        # Config directory (default: ~/.hermes)
HERMES_PROFILE                     # Profile name (isolates settings)
HERMES_MODEL                       # Override default model
HERMES_TEMPERATURE                 # Override temperature
HERMES_QUIET                       # Suppress startup messages

# Provider keys:
ANTHROPIC_API_KEY                  # Claude models
OPENAI_API_KEY                     # GPT models
OPENROUTER_API_KEY                 # OpenRouter
EXA_API_KEY                        # Web search
# ... many more

# Feature flags:
HERMES_OPTIONAL_SKILLS            # Path to optional-skills dir
HERMES_DISABLE_MEMORY             # Skip memory loading
HERMES_DISABLE_CONTEXT_FILES      # Skip .cursorrules, etc.
HERMES_SAVE_TRAJECTORIES          # Enable trajectory logging
```

---

## 13. Key Architectural Decisions

| Decision | Rationale | Trade-offs |
|----------|-----------|-----------|
| **Synchronous agent loop** | Simplicity; tool calling is inherently sequential | No built-in parallelism for independent tool calls (though `delegate_task` spawns subagents) |
| **OpenAI message format** | Compatibility with 200+ models across 10+ providers | Less type-safe than Anthropic types; JSON serialization overhead |
| **Tool registry pattern** | Decoupled tool definitions from orchestration; easy to add tools | Circular import risk (mitigated by import order) |
| **SQLite + FTS5** | No external DB dependency; fast text search; WAL for concurrency | Single-machine only (gateway on one server) |
| **Prompt caching (Anthropic)** | Reduces cost on repeated prompts + memory block | Only for Anthropic models |
| **Context compression on-demand** | Saves auxiliary LLM calls; only compresses when necessary | Requires estimating token counts (rough estimation used) |
| **Async bridging via thread pool** | Avoids "event loop is closed" errors; works in gateway + CLI | Per-thread loop maintenance; slight overhead |
| **Plugin memory system** | Pluggable backends (Honcho, Mem0, etc.) | Complexity; not all backends equally mature |
| **Toolsets composition** | Flexible; supports reuse + custom platforms | Requires explicit resolution (no implicit transitive includes) |
| **SOUL.md for identity** | User-editable personality; persistent across sessions | Hard to A/B test; not programmatically analyzable |
| **Data-driven skins** | Easy to customize CLI without code changes | Limited expressiveness (pure data, no computed fields) |
| **ACP server integration** | Enables editor integration (VS Code, Zed, JetBrains) | Additional maintenance surface |

---

## 14. Known Limitations & Trade-offs

1. **Single-process gateway** — Gateway runs on one server (no distributed scaling)
2. **Synchronous tool loop** — Tool calls are sequential (could parallelize independent calls)
3. **Token estimation** — Rough character-based estimate (not always accurate)
4. **Memory scaling** — Large memory files (>10K lines) may impact latency
5. **Context limit handling** — Compression is best-effort; very long tasks may still exceed limits
6. **MCP server resilience** — No built-in recovery if MCP server crashes mid-call
7. **Skill versioning** — Basic (name + version tag); no dependency management
8. **Platform parity** — Not all features available on all platforms (e.g., voice memos only on Telegram)
9. **Reasoning effort levels** — Only Claude 3.5+ models support extended thinking

---

## 15. Future Roadmap (Inferred from Code)

- **RL training integration** (`rl_cli.py`, `tools/rl_training_tool.py`, `tinker-atropos` submodule)
- **Codex OAuth support** (`agent/copilot_acp_client.py`) — Responses API authentication
- **Dynamic agent configuration** (`agent/smart_model_routing.py`) — Auto-select reasoning models
- **Memory plugin maturation** — Currently honcho, mem0, openviking, holographic, hindsight experimental
- **Mixture of Agents** (`tools/mixture_of_agents_tool.py`) — Route complex queries to parallel specialists
- **Terminal backend abstraction** — Singularity, Daytona, Modal, SSH support for isolated execution

---

## Appendix A: File Manifest

### Top-Level Entry Points
- `run_agent.py` (466 KB) — AIAgent class
- `cli.py` (380 KB) — HermesCLI class
- `model_tools.py` (23 KB) — Tool orchestration
- `toolsets.py` (21 KB) — Toolset definitions
- `hermes_state.py` (52 KB) — Session store
- `batch_runner.py` (55 KB) — Batch processing

### Agent Subsystem (`agent/`)
- `prompt_builder.py` (41 KB) — System prompt assembly
- `context_compressor.py` (29 KB) — Auto compression
- `auxiliary_client.py` (80 KB) — Vision/aux task routing
- `model_metadata.py` (37 KB) — Model catalog + pricing
- `anthropic_adapter.py` (54 KB) — Anthropic-specific handling
- `display.py` (42 KB) — KawaiiSpinner + formatting
- `credential_pool.py` (43 KB) — API key management
- `memory_manager.py` (14 KB) — Memory block building
- `insights.py` (34 KB) — Usage analytics
- `prompt_caching.py` (2 KB) — Cache control
- `skill_commands.py` (12 KB) — Skill slash commands
- `skill_utils.py` (10 KB) — Skill file parsing
- `context_references.py` (16 KB) — Context file scanning
- `redact.py` (7 KB) — Sensitive data removal

### Tools (`tools/`)
- `registry.py` (11 KB) — Central tool registry
- `terminal_tool.py` (67 KB) — Shell execution
- `code_execution_tool.py` (52 KB) — Sandboxed execution
- `browser_tool.py` (85 KB) — Browser automation
- `file_tools.py` (38 KB) — File operations
- `skills_tool.py` (50 KB) — Skill management
- `skills_hub.py` (99 KB) — Marketplace integration
- `delegate_tool.py` (36 KB) — Subagent spawning
- `mcp_tool.py` (84 KB) — MCP protocol support
- `approval.py` (35 KB) — Safety checks
- + 20 more tool files

### CLI (`hermes_cli/`)
- `main.py` (222 KB) — Subcommand routing
- `config.py` (101 KB) — Configuration system
- `commands.py` (37 KB) — Slash command registry
- `setup.py` (122 KB) — Interactive setup
- `tools_config.py` (74 KB) — Tool enable/disable UI
- `skills_hub.py` (46 KB) — Skills marketplace UI
- `skin_engine.py` (35 KB) — Theme system
- `models.py` (53 KB) — Model selection UI
- `auth.py` (104 KB) — Provider authentication
- + 20 more files for providers, setup, profiles, etc.

### Gateway (`gateway/`)
- `run.py` (338 KB) — Main event loop
- `session.py` (42 KB) — Session persistence
- `config.py` (41 KB) — Gateway config
- `platforms/telegram.py` (99 KB)
- `platforms/discord.py` (108 KB)
- `platforms/slack.py` (39 KB)
- + 10 more platform adapters

### ACP Adapter (`acp_adapter/`)
- `server.py` (28 KB) — ACP server
- `session.py` (18 KB) — Session management
- `tools.py` (7 KB) — Tool exposure
- `events.py`, `auth.py`, `permissions.py`

### Cron (`cron/`)
- `scheduler.py` (32 KB) — Scheduler loop
- `jobs.py` (26 KB) — Job definitions

### Plugins (`plugins/memory/`)
- `honcho/` — Dialectic user modeling
- `mem0/`, `openviking/`, `holographic/`, `hindsight/`, `byterover/`

### Skills (`skills/`)
100+ community skills organized by category:
- `productivity/`, `research/`, `devops/`, `creative/`, `data-science/`, etc.

---

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **AIAgent** | Main conversation loop class (run_agent.py) |
| **Toolset** | Named group of tools (web, code, terminal, etc.) |
| **Tool** | Single callable function exposed to LLM (web_search, terminal, etc.) |
| **Skill** | Learned procedural memory — multi-step instructions saved for reuse |
| **Memory** | Persistent user/session context (SOUL.md, MEMORY.md, USER.md) |
| **Context file** | Project-specific instructions (AGENTS.md, .cursorrules) |
| **Session** | Single conversation thread, stored in SQLite |
| **Gateway** | Async event loop for multi-platform messaging |
| **Platform adapter** | Concrete implementation for one messaging service (Telegram, Discord, etc.) |
| **MCP server** | Model Context Protocol server exposing tools dynamically |
| **Skill Hub** | Community marketplace (agentskills.io) for sharing skills |
| **Prompt caching** | Optimization to reduce cost on repeated prompts (Anthropic) |
| **Context compression** | Auto-summarization of old turns when approaching context limit |
| **ACP** | Agent Client Protocol (for IDE integration) |
| **Trajectory** | Log of a single task (messages + tool calls, used for RL training) |

---

**Document generated:** 2026-04-06  
**Hermes Agent version:** 0.7.0  
**Python version:** 3.11+
