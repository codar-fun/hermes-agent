# 09 · MCP 与插件扩展

想给 Hermes 加新能力，有三条路：**接入 MCP 服务器**（最常见，无需写代码）、**写插件**（深度集成）、**用 ACP 接编辑器**。

---

## 1. 接入 MCP 服务器

[MCP（Model Context Protocol）](https://modelcontextprotocol.io) 是连接外部工具的开放标准。任何 MCP 服务器（stdio / HTTP / SSE）都能接进来，其工具会通过工具搜索桥接暴露给智能体（`tools/mcp_tool.py`）。

> 📖 MCP 的完整管理（全部子命令、配置 schema、工具过滤、OAuth、Sampling、目录一键安装）见独立文档 [12 · MCP 管理详解](./12-MCP管理详解.md)。本节为快速上手。

### 命令

```bash
hermes mcp                 # 交互式 picker（默认）
hermes mcp list            # 列出已装 MCP 及状态
hermes mcp add <名字>      # 交互式添加（引导填传输方式、env）
hermes mcp remove <名字>   # 移除
hermes mcp test <名字>     # 探测连接并发现工具
hermes mcp configure <名字># 勾选要启用的工具
```

会话内用 `/reload-mcp` 从配置重载 MCP 服务器。

### 配置格式

MCP 服务器配置在 `~/.hermes/config.yaml` 的 `mcp_servers` 段，支持三种传输：

**A. stdio（子进程命令）**

```yaml
mcp_servers:
  filesystem:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    env: {}
    timeout: 120           # 工具调用超时（秒）
    connect_timeout: 60    # 连接超时（秒）
```

**B. HTTP（Streamable HTTP）**

```yaml
mcp_servers:
  remote_api:
    url: "https://my-mcp-server.example.com/mcp"
    headers:
      Authorization: "Bearer ${MCP_API_KEY}"   # ${VAR} 在连接时从 .env 解析
    timeout: 180
```

**C. SSE（Server-Sent Events）**

```yaml
mcp_servers:
  searxng:
    url: "http://localhost:8000/sse"
    transport: "sse"
    timeout: 180
    connect_timeout: 10
```

### 进阶选项

```yaml
mcp_servers:
  github:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_PAT}"
    supports_parallel_tool_calls: true   # 允许并发执行其工具
    sampling:                            # 服务器可反向请求 LLM 补全
      enabled: true
      model: "gemini-3-flash"
      max_tokens_cap: 4096
      timeout: 30
      max_rpm: 10
      max_tool_rounds: 5
```

> - 配置值里的 `${ENV_VAR}` 在连接时从 `~/.hermes/.env` 解析（含 `headers` 里的）。
> - 仓库自带可选 MCP 目录在 `optional-mcps/<名字>/`（如 linear、n8n），默认禁用，用 picker 安装。

---

## 2. 插件系统

插件是比 MCP 更深度的扩展点，能挂生命周期钩子、注册工具、加 CLI 子命令。**绝大多数自定义/本地工具都应走插件，而不是改 Hermes 核心。**

### 创建一个插件

```
~/.hermes/plugins/<名字>/
├── plugin.yaml          # 清单（name、version、hooks 等）
└── __init__.py          # 暴露 register(ctx) 函数
```

`register(ctx)` 里可以：

- 注册工具：`ctx.register_tool(...)`
- 挂钩子：`ctx.register_hook(name, fn)`
- 注册斜杠命令 / CLI 子命令：`ctx.register_command(...)` / `ctx.register_cli_command(...)`
- 访问宿主 LLM：`ctx.llm`

### 可用钩子

`pre_tool_call`、`post_tool_call`、`transform_terminal_output`、`transform_tool_result`、`transform_llm_output`、`pre_llm_call`、`post_llm_call`、`pre_api_request`、`post_api_request`、`api_request_error`、`on_session_start`、`on_session_end`、`on_session_finalize`、`on_session_reset`、`subagent_start`、`subagent_stop`、`pre_gateway_dispatch`、`pre_approval_request`、`post_approval_response`。

### 发现来源（后者覆盖前者）

1. 仓库内置：`<repo>/plugins/<名字>/`
2. 用户：`~/.hermes/plugins/<名字>/`
3. 项目级：`./.hermes/plugins/<名字>/`（需 `HERMES_ENABLE_PROJECT_PLUGINS`）
4. pip 入口点：暴露 `hermes_agent.plugins` 入口组的包

```text
/plugins      # 列出已安装插件及状态
```

调试：`HERMES_PLUGINS_DEBUG=1` 打开插件发现的详细日志。

### 插件类别

- **memory**：可插拔记忆后端（honcho、mem0…，独占类别）
- **model-providers**：推理后端（openrouter、anthropic、deepseek… 共 29 个）
- **context_engine**：上下文引擎（独占）
- **platforms**：消息平台适配器
- **image_gen / video_gen**：媒体生成
- **kanban / teams_pipeline**：多智能体协作
- **observability**：指标/追踪/日志
- 其他：disk-cleanup、google_meet、spotify、hermes-achievements、security-guidance…

> **硬规则**：插件**不得修改核心文件**（`run_agent.py`、`cli.py`、`gateway/run.py`、`hermes_cli/main.py` 等）。框架缺能力时应扩展通用插件接口（加钩子、加 ctx 方法），而不是把插件逻辑硬编进核心。

---

## 3. 新增核心工具（仅贡献者）

若你是在给 Hermes 主体贡献新工具，需要改两个文件：

1. 建 `tools/your_tool.py`，在模块顶层调用 `registry.register(name, toolset, schema, handler, check_fn, ...)`。任何含顶层 `registry.register()` 的 `tools/*.py` 都会被自动导入。
2. 在 `toolsets.py` 把工具名加进某个工具集（`_HERMES_CORE_TOOLS` 或新工具集）——这一步必须手动，否则工具不会暴露给智能体。

所有 handler 必须返回 JSON 字符串。详见根目录 `AGENTS.md` 的「Adding New Tools」。

---

## 4. ACP 编辑器集成

Hermes 可作为 ACP（Agent Client Protocol）服务器，集成进 VS Code / Zed / JetBrains 等编辑器：

```bash
hermes acp        # 以 ACP 服务器模式运行
```

实现见 `acp_adapter/`。这让你在编辑器里直接使用 Hermes 智能体（编辑审批、权限、会话等通过 ACP 协议交互）。

---

下一步 → [10 · 安全与权限](./10-安全与权限.md)
