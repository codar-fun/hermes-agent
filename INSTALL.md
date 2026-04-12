# Installation Guide

## Prerequisites

- Linux / macOS / WSL2
- `curl`

## 1. Install uv

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.):

```bash
export PATH="$HOME/.local/bin:$PATH"
```

Reload your shell or run `source ~/.bashrc`.

## 2. Create the virtual environment

From the repo root:

```bash
uv venv venv --python 3.11
source venv/bin/activate
```

uv will automatically download Python 3.11 if it isn't already installed.

## 3. Install hermes-agent

```bash
uv pip install -e ".[all,dev]"
```

This installs all optional extras (messaging platforms, voice, MCP, Daytona, Modal, Honcho, etc.) plus dev dependencies (pytest, debugpy).

## 4. Activate and run

```bash
source venv/bin/activate
hermes
```

## Activating in future sessions

```bash
source /path/to/hermes-agent/venv/bin/activate
hermes
```

## Optional extras (install individually)

| Extra | Includes |
|---|---|
| `messaging` | Telegram, Discord, Slack, WhatsApp |
| `voice` | Local STT via faster-whisper |
| `modal` | Modal cloud sandboxes |
| `mcp` | MCP client |
| `honcho` | Honcho memory provider |
| `rl` | Atropos RL environments |
| `all` | Everything except `rl` and `matrix` |
| `dev` | pytest, debugpy |

```bash
uv pip install -e ".[messaging,voice]"
```

## First-time setup

```bash
hermes setup    # Interactive wizard: model, API keys, platform config
hermes model    # Change active LLM
hermes tools    # Enable/disable toolsets
```
