# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Setup

```bash
uv venv venv --python 3.11 && source venv/bin/activate
uv pip install -e ".[all,dev]"
source venv/bin/activate  # ALWAYS activate before running Python
```

## Running & Testing

```bash
hermes                                              # Interactive CLI
hermes gateway                                      # Messaging gateway (Telegram, Discord, etc.)

python -m pytest tests/ -q                          # Full suite (~3000 tests, ~3 min)
python -m pytest tests/test_model_tools.py -q       # Toolset resolution
python -m pytest tests/test_cli_init.py -q          # CLI config loading
python -m pytest tests/gateway/ -q                  # Gateway tests
python -m pytest tests/tools/ -q                    # Tool-level tests
```

Always run the full suite before pushing changes.

## High-Level Architecture

Hermes is a self-improving AI agent by Nous Research. Entry points:
- `cli.py` — `HermesCLI` class, interactive TUI (Rich + prompt_toolkit)
- `run_agent.py` — `AIAgent` class, synchronous conversation loop
- `gateway/run.py` — async messaging gateway for Telegram, Discord, Slack, etc.
- `hermes_cli/main.py` — all `hermes` CLI subcommands (model, tools, setup, etc.)

### File Dependency Chain

```
tools/registry.py  (no deps — imported by all tool files)
       ↑
tools/*.py  (each calls registry.register() at import time)
       ↑
model_tools.py  (imports tools/registry + triggers tool discovery)
       ↑
run_agent.py, cli.py, batch_runner.py, environments/
```

### Agent Loop (`run_agent.py`)

The core loop in `run_conversation()` is **entirely synchronous**. Messages follow OpenAI format. The loop calls the LLM, handles tool calls via `handle_function_call()`, and repeats until no more tool calls or `max_iterations` is reached.

### Slash Commands (`hermes_cli/commands.py`)

All slash commands are defined in a central `COMMAND_REGISTRY` list of `CommandDef` objects. All downstream consumers (CLI dispatch, gateway, Telegram menus, Slack routing, autocomplete, help text) derive from this registry automatically.

**To add a slash command:** add a `CommandDef` to `COMMAND_REGISTRY`, add a handler in `HermesCLI.process_command()` in `cli.py`, and (if gateway-available) add a handler in `gateway/run.py`. Aliases only need adding to the `aliases` tuple — no other changes required.

### Tools (`tools/`)

Each tool file self-registers at import time via `registry.register()`. All handlers must return a JSON string. **To add a tool:**
1. Create `tools/your_tool.py` with `registry.register(...)` at the bottom
2. Add the import in `model_tools.py` `_discover_tools()` list
3. Add to `toolsets.py` — either `_HERMES_CORE_TOOLS` or a new toolset

### Configuration

Two separate config loaders:
- `load_cli_config()` in `cli.py` — used by the interactive CLI
- `load_config()` in `hermes_cli/config.py` — used by `hermes tools`, `hermes setup`
- Gateway loads config directly from YAML

User config lives at `~/.hermes/config.yaml` (settings) and `~/.hermes/.env` (API keys).

To add a config option: add to `DEFAULT_CONFIG` in `hermes_cli/config.py` and bump `_config_version`.

## Critical Rules

### Profile Safety — Use `get_hermes_home()` Everywhere

Hermes supports isolated profiles via `HERMES_HOME`. **Never hardcode `~/.hermes`.**

```python
# GOOD
from hermes_constants import get_hermes_home, display_hermes_home
config_path = get_hermes_home() / "config.yaml"
print(f"Saved to {display_hermes_home()}/config.yaml")

# BAD — breaks profiles
config_path = Path.home() / ".hermes" / "config.yaml"
```

Tests that mock `Path.home()` must also set `HERMES_HOME` env var (see `tests/conftest.py`'s `_isolate_hermes_home` autouse fixture — tests must never write to `~/.hermes/`).

### Prompt Caching Must Not Break

Do NOT alter past context, change toolsets, or reload memories/system prompts mid-conversation. Cache-breaking forces dramatically higher costs. The only permitted mid-conversation context change is during context compression.

### Known Pitfalls

- **No `simple_term_menu`** — rendering bugs in tmux/iTerm2. Use `curses` instead (see `hermes_cli/tools_config.py`).
- **No `\033[K`** (ANSI erase-to-EOL) in spinner/display code — leaks as `?[K` under `prompt_toolkit`. Use space-padding: `f"\r{line}{' ' * pad}"`.
- **No hardcoded cross-tool references in schema descriptions** — those tools may be unavailable. Add cross-references dynamically in `get_tool_definitions()` in `model_tools.py`.
- **`_last_resolved_tool_names` is a process-global** in `model_tools.py` — `_run_single_child()` in `delegate_tool.py` saves/restores it around subagent execution.
- Tool schema descriptions that reference file paths should use `display_hermes_home()` to be profile-aware.

## Skin/Theme System

Skins are pure data — no code changes needed to add one. Add to `_BUILTIN_SKINS` in `hermes_cli/skin_engine.py`, or users drop a YAML file in `~/.hermes/skins/`. Activate with `/skin <name>` or `display.skin: <name>` in config.yaml.

## Full Developer Reference

See `AGENTS.md` for the complete developer guide including detailed architecture diagrams, the `AIAgent` API, skill system internals, gateway platform adapter patterns, and RL training integration.
