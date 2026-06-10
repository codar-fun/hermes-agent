# 12 · MCP 管理详解

这是 [09 · MCP 与插件扩展](./09-MCP与插件扩展.md) 中 MCP 部分的深度补充，完整讲清如何**管理** MCP（Model Context Protocol）服务器：命令、配置 schema、工具过滤、OAuth、目录安装、运行时行为。

> 本文所有子命令、配置键、默认值、令牌路径均核对自源码（`hermes_cli/main.py`、`mcp_config.py`、`mcp_catalog.py`、`tools/mcp_tool.py`、`tools/mcp_oauth*.py`）。

MCP 让 Hermes 接入任意外部工具服务器。接进来的工具会以 `mcp_<服务器>_<工具名>` 的形式注册，并通过工具搜索桥接（`tool_search`/`tool_describe`/`tool_call`）按需暴露给模型——不会一次性撑爆上下文。

---

## 1. `hermes mcp` 子命令全表

```bash
hermes mcp                       # = picker：交互式目录选择器（默认）
hermes mcp picker                # 同上
hermes mcp catalog               # 列出 Nous 批准、可一键安装的 MCP
hermes mcp install <名字>        # 从目录安装（如 hermes mcp install n8n）

hermes mcp add <名字> [选项]      # 发现式添加一个服务器（见下）
hermes mcp list                  # 列出已配置的服务器及状态（别名 ls）
hermes mcp test <名字>           # 测试连接、列出发现到的工具
hermes mcp configure <名字>      # 重新勾选要暴露的工具（别名 config）
hermes mcp login <名字>          # 对 OAuth 服务器强制重新认证
hermes mcp remove <名字>         # 移除服务器（别名 rm）

hermes mcp serve [-v]            # 把 Hermes 自己作为 MCP 服务器，向其他智能体暴露对话
```

### `hermes mcp add` 的选项

```bash
hermes mcp add <名字> \
  --url <URL>              # HTTP/SSE 端点（远程服务器）
  --command <命令>         # stdio 命令（如 npx）——与 --url 二选一
  --args <参数...>         # stdio 命令的参数
  --auth {oauth,header}    # 认证方式
  --preset <预设名>        # 已知预设（目前内置 codex）
  --env KEY=VALUE ...      # stdio 服务器的环境变量
```

`add` 是「发现优先」的：它会先连上服务器、列出工具，让你勾选要启用哪些，再写入配置。

会话内还可用斜杠命令 **`/reload-mcp`** 从配置热重载 MCP 服务器（无需重启网关，见 §7）。

---

## 2. 配置 schema：`mcp_servers`

MCP 服务器都配置在 `~/.hermes/config.yaml` 的 `mcp_servers` 段下。每个服务器**必须**要么有 `command`（stdio），要么有 `url`（HTTP/SSE）。

### stdio（子进程命令）

```yaml
mcp_servers:
  github:
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "${GH_TOKEN}"   # ${VAR} 在连接时解析
    timeout: 120            # 每次工具调用超时（秒），默认 120
    connect_timeout: 60     # 初始连接超时（秒），默认 60
    enabled: true           # 默认 true；false = 保留配置但不连接
```

### HTTP（Streamable HTTP，默认）

```yaml
mcp_servers:
  remote_api:
    url: "https://my-mcp-server.example.com/mcp"
    headers:
      Authorization: "Bearer ${MCP_API_KEY}"
    timeout: 180
    connect_timeout: 60
```

### SSE（Server-Sent Events）

```yaml
mcp_servers:
  searxng:
    url: "http://localhost:8000/sse"
    transport: "sse"        # 显式声明 SSE；不写则按 Streamable HTTP 处理
    timeout: 180
    connect_timeout: 10
```

> **传输自动判定**：有 `url` → HTTP 传输（`transport: sse` 时走 SSE，否则 Streamable HTTP）；有 `command` → stdio。`transport` 仅接受 `sse`。

### 完整选项参考

| 键 | 默认 | 说明 |
|----|------|------|
| `command` / `args` / `env` | — | stdio 传输 |
| `url` / `headers` / `transport` | — | HTTP/SSE 传输（`transport: sse` 或留空）|
| `timeout` | `120` | 每次工具调用超时（秒）|
| `connect_timeout` | `60` | 初始连接超时（秒）|
| `enabled` | `true` | `false` = 禁用但保留配置 |
| `supports_parallel_tool_calls` | `false` | 允许该服务器的工具并发执行 |
| `tools.include` / `tools.exclude` | — | 工具白/黑名单（见 §3）|
| `tools.resources` / `tools.prompts` | `true` | 是否注册资源/提示类工具 |
| `auth` | — | `oauth`（见 §5）|
| `sampling.*` | 见 §6 | 服务器反向 LLM 调用 |
| `ssl_verify` | `true` | HTTPS 证书校验 |
| `client_cert` / `client_key` | — | mTLS 客户端证书（单 PEM、或 [cert,key]、或 [cert,key,passphrase]）|

---

## 3. 工具暴露与过滤

一台 MCP 服务器可能暴露很多工具，你通常只想开放其中几个。

```yaml
mcp_servers:
  linear:
    url: "https://mcp.linear.app/mcp"
    auth: "oauth"
    tools:
      include:                 # 白名单：只暴露这些（优先级高于 exclude）
        - find_issues
        - create_issue
      # exclude:               # 黑名单：暴露除这些以外的全部
      #   - delete_project
      resources: true          # 是否注册 mcp_<server>_list_resources / read_resource
      prompts: true            # 是否注册 mcp_<server>_list_prompts / get_prompt
```

- 设了 `include` → 只注册名字在白名单里的工具；
- 否则设了 `exclude` → 注册除黑名单外的全部；
- 都不设 → 注册全部。
- **交互式勾选**：`hermes mcp configure <名字>` 会重新探测服务器并用清单让你勾选，结果写回 `tools.include`。
- **工具命名**：实际工具名为 `mcp_<服务器>_<工具>`（如 `mcp_linear_find_issues`）；工具集别名可用简短的 `<服务器名>`。

> 当非核心工具超出上下文预算时，MCP 工具会藏到 `tool_search` / `tool_describe` / `tool_call` 桥接背后（渐进式披露），模型按需检索调用。

---

## 4. 环境变量插值

配置里的 `${VAR}` 会在连接时解析，可用于 `command`、`args`、`env`、`url`、`headers` 等所有字符串值：

```yaml
mcp_servers:
  remote:
    url: "https://api.example.com/mcp"
    headers:
      Authorization: "Bearer ${API_KEY}"     # 取自 ~/.hermes/.env 或系统环境
```

解析来源：先 `~/.hermes/.env`，再当前 `os.environ`；不存在的变量保持字面原样（如 `${MISSING}` 不替换）。把密钥放进 `.env`、在配置里用 `${...}` 引用，避免明文写进 `config.yaml`。

---

## 5. OAuth 认证

对于需要 OAuth 的远程 MCP 服务器（如 Linear），设 `auth: oauth` 即可。Hermes 支持原生 MCP OAuth 2.1（PKCE），通常无需第三方提供商。

```yaml
mcp_servers:
  linear:
    url: "https://mcp.linear.app/mcp"
    auth: "oauth"
    oauth:                       # 以下均可选
      client_id: "..."           # 预注册的 client（跳过动态注册）
      client_secret: "..."
      scope: "read write"
      redirect_port: 0           # 0 = 自动选空闲端口
      client_name: "Hermes Agent"
```

### 令牌存储与命令

- 令牌存在 **`~/.hermes/mcp-tokens/`**（权限 0600）：
  - `<服务器>.json` —— 访问/刷新令牌
  - `<服务器>.client.json` —— 客户端注册信息
  - `<服务器>.meta.json` —— OAuth 服务器元数据
- 首次连接会自动弹浏览器走授权流；令牌过期自动用 refresh_token 刷新。
- **`hermes mcp login <名字>`**：强制重新认证——清除磁盘与内存里的令牌，重新探测并触发浏览器流，最后校验令牌确实写盘。
- `hermes mcp remove <名字>` 会一并清理该服务器的 OAuth 令牌。

`MCPOAuthManager`（`tools/mcp_oauth_manager.py`）负责冷启动重载磁盘令牌、对并发 401 去重恢复、预取 OAuth 元数据、以及触发重连。

---

## 6. Sampling（服务器反向请求 LLM）

MCP 协议允许服务器反过来请求宿主跑一次 LLM 补全（`sampling/createMessage`）。Hermes 默认开启，并把它路由到**辅助模型**（`auxiliary`，而非主会话模型），带速率与轮次限制：

```yaml
mcp_servers:
  myserver:
    url: "..."
    sampling:
      enabled: true            # 默认 true
      model: "gemini-3-flash"  # 可选，覆盖默认辅助模型
      max_tokens_cap: 4096     # 单次响应 token 上限
      timeout: 30              # LLM 调用超时（秒）
      max_rpm: 10              # 每分钟最大请求数
      max_tool_rounds: 5       # 工具循环深度上限（0 = 禁用工具循环）
      allowed_models: []       # 模型白名单（空 = 不限）
      log_level: "info"        # debug / info / warning
```

模型解析顺序：`sampling.model` > 服务器请求里的提示 > 默认辅助模型。

---

## 7. 运行时行为

- **`/reload-mcp`**（会话内）：确认后关闭所有 MCP 连接、重读 `config.yaml`、重新发现工具，对比新旧服务器集并更新缓存智能体的工具（无需失效整个会话，下一轮生效），最后显示「新增/移除/重连」摘要。
- **启动**（`hermes_cli/mcp_startup.py`）：后台线程异步发现 MCP（非阻塞），短暂等待（约 0.75s）；没配 `mcp_servers` 的用户零开销。
- **错误净化**：MCP 工具错误会过滤掉疑似密钥（GitHub PAT、Bearer token、`key=`/`password=` 等）替换为 `[REDACTED]` 再回传模型；stdio 子进程只继承安全环境变量 + 你显式声明的 `env`。
- **重连**：遇到 401 等会重建传输与会话，用刷新后的凭据重连。

---

## 8. 目录与 optional-mcps（一键安装）

仓库自带一个 **Nous 批准的 MCP 目录**（随仓库发布，无远程目录 URL；新增条目通过 PR 合并）。

```bash
hermes mcp catalog          # 列出可一键安装的条目
hermes mcp                  # 或交互式 picker 选择并安装
hermes mcp install n8n      # 直接按名字安装
```

目录条目在 `optional-mcps/<名字>/manifest.yaml`，例如：

- **linear** —— 查找/创建/更新 Linear issue 与 project（HTTP + 原生 OAuth 2.1）
- **n8n** —— 管理 n8n 工作流（stdio + git 安装 + API Key）

### manifest 格式（概要）

```yaml
manifest_version: 1
name: <标识>
description: <一句话>
source: <url>

transport:
  type: stdio | http
  command: "..."         # stdio：可执行（支持 ${INSTALL_DIR}）
  args: [...]
  url: "..."             # http：端点

auth:
  type: api_key | oauth | none
  env:                   # api_key：需要的环境变量（写入 .env）
    - name: MY_API_KEY
      prompt: "输入 API Key"
      required: true
      secret: true
  provider: "..."        # oauth：第三方提供商（可选）
  scopes: ["..."]

install:                 # 可选：git clone + 引导脚本
  type: git
  url: <repo>
  ref: <commit|tag>      # 固定版本，不浮动
  bootstrap:
    - "python3 -m venv .venv"
    - ".venv/bin/pip install -r requirements.txt"

tools:
  default_enabled: [...]  # 安装时预勾选的工具

post_install: |
  安装后给用户的提示文字……
```

安装流程：选中条目 → 若需 git 安装则 clone + 引导 → 按 `auth.type` 提示填环境变量（写入 `.env`）或标记 `auth: oauth` → 生成 `mcp_servers.<名字>` 块写入 `config.yaml` → 探测服务器并让你勾选工具 → 显示 `post_install` 提示。

---

## 9. 把 Hermes 当作 MCP 服务器

反过来，Hermes 也能作为 MCP 服务器，把自己的对话能力暴露给其他智能体/编辑器：

```bash
hermes mcp serve            # 以 MCP 服务器模式运行
hermes mcp serve -v         # stderr 输出详细日志
```

---

## 10. 常见操作速查

| 目标 | 命令 / 配置 |
|------|-------------|
| 加一个本地 stdio 服务器 | `hermes mcp add fs --command npx --args -y @modelcontextprotocol/server-filesystem /tmp` |
| 加一个远程 HTTP 服务器 | `hermes mcp add api --url https://.../mcp --auth header`（在配置里加 `headers`）|
| 加一个 OAuth 服务器 | `hermes mcp add linear --url https://mcp.linear.app/mcp --auth oauth` |
| 只暴露某几个工具 | 配置 `tools.include`，或跑 `hermes mcp configure <名字>` |
| 临时停用某服务器 | 配置里设 `enabled: false`，或直接 `hermes mcp remove` |
| 重新登录 OAuth | `hermes mcp login <名字>` |
| 改完配置即时生效 | 会话内 `/reload-mcp` |
| 看连得通不通、有哪些工具 | `hermes mcp test <名字>` |
| 从目录一键装 | `hermes mcp install <名字>` 或 `hermes mcp`（picker）|

---

← 返回 [文档索引](./README.md) ｜ 相关：[09 · MCP 与插件扩展](./09-MCP与插件扩展.md)
