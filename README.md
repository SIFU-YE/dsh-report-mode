# dsh-report-mode

把 DSH 的**报表模式**打包成一个可安装、可升级、可发布的 DSH 插件。

报表模式是给 FineReport（帆软）报表交付用的一套工作环境：通过已挂载能力完成 `.cpt`
增删改查、官方文档检索、Doris/MySQL 取数、本地预览与 Excel 只读；
**工作产物只提交到本地仓库，不上云**。本预设内置本地 git 工具
（init/status/diff/log/commit/branch，vendored 自 `dsh-plugin-git-workflow`），
不注册 push / 建远端能力；
`sandbox*` 历史数据只保留在本地仓库。

- 预设 id：`report-mode`，显示名「报表模式」
- 插件 id：`dsh-report-mode`
- 目标仓库：`SIFU-YE/dsh-report-mode`（GitHub；任务代码仓库，不是报表产物）

---

## 1. 这个仓库解决什么问题

报表模式原本是**一份手写的预设**（`~/.dsh/.agent-presets/report/agent.cordis.yml`）
加**一份改过的 AgentTeams fork**。这种形态有三个硬伤：

| 硬伤 | 后果 |
| --- | --- |
| 预设里有明文库口令、内网主机名、本机绝对路径 | 没法分享/发布，一推就等于泄漏 |
| AgentTeams 的报表适配直接改在 fork 源码里 | 跟着上游升级 = 手工重放一堆改动，几乎不可维护 |
| 装完就散了：没有版本、没有升级路径、没法给别人装 | 换机器 / 给同事 → 靠人肉复制粘贴 |

这个仓库的答案：

1. **预设进插件包，凭据出仓库。** 所有连接信息走 `<DSH_HOME>/.env`（DSH 的 user 层
   环境文件，不进任何仓库），预设里只留 `!!js process.env.*` 表达式。
2. **不再内置完整 fork。** 依赖 **npm 原版** `@nanmicoder/dsh-agent-teams`，报表适配
   只以一个 ~260 行的补丁文件存在（见第 3 节）。
3. **一份可安装的 npm 包。** `dsh plugin --profile <name> add <tgz 或 git 地址>`，
   升级 = 换版本号，装完自动落地预设。

---

## 2. 装完你会得到什么

### 本地 git：报表工作产物只落本地仓库

报表模式内置本地 git 工具（`lib/local-git`，vendored 自 `dsh-plugin-git-workflow`）：

| 工具 | 作用 |
| --- | --- |
| `git_init` | 在工作区没有 `.git` 时初始化本地仓库（不建远端） |
| `git_status` | 只读查看分支/暂存区/未提交改动 |
| `git_diff` | 查看工作区或暂存区差异 |
| `git_log` | 查看最近提交 |
| `git_commit` | 暂存指定路径并创建本地提交 |
| `git_branch` | 列出本地分支 |

本预设**不注册 push / 建远端 / fetch / pull 工具**，也不使用 Gitee/GitHub 远端。
规则：

- `.cpt`、SQL、样例、预览产物等只做**本地提交**，不上传云端；
- `sandbox*` 开头的目录/文件是历史数据：只保留本地仓库，任何工具都不得上传；
- 工作区尚未建仓时先用内置本地 git 工具初始化仓库，再做本地提交；
- 只有工具不可用时才标注「未落库」，不要假装已提交。

### 预设 `report-mode`（在预设选择器里出现「报表模式」）

- MCP 服务器（7 个）：`cpt-mcp`、`fr-docx-mcp`、`doris`、`mysql`、`testdb`、`browser`、`excel`
- 本地工具：`read/write/edit`、`glob/grep`、`ask_user_question`、`todo`、`subagent`、
  `delete_file`（0.1.28 起内置，预设内 scoped 行：**仅报表模式可见**；默认移入同级
  `.trash`，`use_trash:false` 才硬删；工作区外与受保护路径段拒绝）
- 工具护栏（预设内 scoped 行，`restrict` 隐藏 schema + `guard` 调用时拒绝，0.1.31 起）：
  - host 级 `mcp-toolbox` 的 3 个 query 工具、host 团队工具
    （`spawn_teammate` / `wait_agent` / `team_task_*`）在报表模式被 deny；
  - 内置本地 git 工具（`git_init` / `git_status` / `git_diff` / `git_log` / `git_commit` /
    `git_branch`）：报表产物只做本地提交；它们没有 push / 远端能力；
  - 旧版 `dsh-report-git` 的六个工具（`git_commit_all` / `git_repo_status` /
    `git_rollback` / `git_link_remote` / `git_fetch` / `git_pull`）在报表模式被 deny：
    即使旧会话或残留 host 组合仍注册了它们，调用也会被 guard 拒绝，不能借此推送 Gitee；
  - 浏览器**两层**限制：`navigate_page` / `new_page` 由工具层 guard 只放行 `localhost` /
    `127.0.0.1` / `*.localhost` / `about:blank`（不含 IPv6：URLPattern 不支持 `[::1]`）；
    mcp-browser 另加 `--allowedUrlPattern` 在**浏览器网络层**只放行同样来源，连子资源、
    重定向与 `evaluate_script` 内的 `fetch` / `WebSocket` / `location.href` 一并拦住。
    后者依赖 **Chrome 149+**（本机 Chrome 156 实测；Chrome 更旧时 MCP 可能启动失败）。
- 目标与计划（0.1.47 起）：`/goal` 命令 + `goal` 工具用于跨轮目标；plan mode 先给完整方案，`exit_plan_mode` 确认后才进入实现，计划阶段不改文件。
- compaction 组（`compaction` + `tool-result-pruner`，带 `isolate` realm）
- 一份精简的报表工程师 persona：只定义身份、模式级安全/交付约束与工作方式；
  具体 MCP 工具用法以各服务自己的 instructions/schema 为准，persona 不点名工具。
  版本控制只做本地提交，不 push、不建远端、不上传云端；`sandbox*` 历史数据仅本地。

刻意**不给**：shell、公网、后台任务。

预设以 **DSH 0.2.0 的声明行**提供：`cordis.patch.yml` 里插入一行
`id: preset-report-mode` / `name: '@deepseek-ai/dsh-agent-preset'`，其 `plugins` 列表就是
`presets/report-mode/agent.cordis.yml` 的内容。DSH 0.2.0 起**不再读**
`$DSH_HOME/.agent-presets/<id>/` 目录（旧格式已废弃），预设只能这样随 bundle patch 下发；
`lib/bootstrap.js` 的目录自举在 0.2.0 上默认停用（`presetAutoInstall: false`）。

> ⚠️ **只改镜像不会生效**：`cordis.patch.yml` 的 `plugins` 由
> `presets/report-mode/agent.cordis.yml` 生成（0.1.29 起）。改完 personas 后必须运行
> `npm run sync:preset`；`npm test` 的 `sync-preset.mjs --check` 会拦住"只改镜像、没改
> 装配源"的漂移（历史上连续 3 次 persona 提交因此没有进入运行中的宿主）。

> ⚠️ **安装/升级后必须完整重启 DSH**：Host 在启动时读取 bundle patch 并组合预设；仅
> "新开会话"或"重开窗口"不会重新组合。0.1.30 实测：安装完成后新建的报表会话仍挂旧
> persona 与旧工具面（19 MB 的 bundle 已更新，但运行的 Host 进程早于安装时刻）。重启后
> 验收：`mcp__toolbox__*` 与 host 团队工具不再出现；浏览器打开公网 URL 被拒（含
> `evaluate_script` 里的 `fetch`——浏览器网络层 allowlist 生效）。

### 浏览器半区

当**当前会话是某个团队的队长会话**时，界面加深色背景与右上角 `AgentTeams` 角标。
它只用 `/plugins/dsh-agent-teams/state` 路由 + `ctx.sessions` 这类公开接口，因此从
AgentTeams fork 里搬到了本插件的 client 半区——顺带让补丁又小了一块。

---

## 3. 为什么 AgentTeams 是「原版 + 补丁」（3A 方案）

> **0.1.23 起团队模式已下线**：预设不再注册 `@nanmicoder/dsh-agent-teams`，也不再有队长/
> 成员那套协作。本节与 `patches/`、`tools/apply-patch.mjs`、`docs/PATCH.md` 作为历史资产
> 与「要恢复团队模式时的可选路径」保留；日常安装**不需要**装原版 AgentTeams、也不需要打补丁。

报表模式对 AgentTeams 的适配一共 5 项。逐项判断能不能靠公开接口做成「零补丁」：

| # | 适配项 | 结论 | 落点 |
| --- | --- | --- | --- |
| A | 命令-only（关掉自然语言手势开团） | **必须补丁**：上游没有单独开关（`slashCommand` 同时管命令与手势） | 补丁，1 行 |
| B | 成员间消息自动通知队长 | **必须补丁**：纯内部函数，外部拿不到 | 补丁，~24 行 |
| C | 分域记忆 + 授权读取（3 个工具） | **必须补丁**：工具注册表在内部 | 补丁，~90 行 + 新模块 91 行 |
| D | 队长会话深色背景/角标 | 可外移：只用公开路由 + 公开服务 | 本包 `client/index.js`，零补丁 |
| E | 成员/队长协作规则文本 | 可外移：上游本就支持 `executionPrompt`（全局/按 profile/按成员三级） | `cordis.patch.yml` 配置，零补丁 |

所以：**不 fork**，依赖 npm 原版的 `@nanmicoder/dsh-agent-teams@0.1.20`，把 A/B/C 做成
一个补丁文件放在 `patches/`。补丁全貌、上游升版后如何重新生成，见
[`docs/PATCH.md`](docs/PATCH.md)。

### 为什么不用 `git apply` 打这个补丁

两个坑，都踩过了：

1. **行尾**：上游 npm 包里的 `lib/*.js` 是 CRLF，而 `git diff` 产出的是 LF 补丁，直接打会失败。
2. **仓库上下文**（更隐蔽）：`git apply` 在有仓库上下文的目录里会改变行为。当时的事故是
   用户主目录被 `git init` 成了 worktree = 整个主目录的仓库，于是 `%TEMP%` 这类路径也落在
   该仓库内，实测 `git apply` 会打印 `Skipped patch` 并**静默地什么都不做，退出码还是 0**
   ——"补丁已应用"会变成假象。

因此 `tools/apply-patch.mjs` 自带一个最小 unified-diff 应用器：不依赖 git、不受仓库
上下文影响、在内存里归一化行尾后按目标原样写回，并且每一步都用 sha256 校验兜底。

---

## 4. 安装

**推荐从任务代码仓库（GitHub）安装**；离线时用本地 tgz。报表产物与 `sandbox*` 历史数据
只落本地仓库，不需要任何远端凭据。更完整的迁移/验收步骤见 [`docs/INSTALL.md`](docs/INSTALL.md)。

```bash
# 1) 装本插件（预设 + 体检）
dsh plugin --profile <profile> add <GitHub 仓库地址或本地路径>

# 2) 填环境变量（模板：config/report-mode.env.example；.env 本身不进仓库）
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
cp -f config/report-mode.env.example "$DSH_HOME/.env"
notepad "$DSH_HOME/.env"

# 3) 重启 DSH
```

本地 tgz 等价写法：`dsh plugin --profile <profile> add file:<tgz 路径>`（`<tgz 路径>` 换成
`npm pack` 产物的真实位置）。

### 迁移到其他电脑 / 不同 DSH 安装位置

本包不绑定 DSH 安装目录；但外部 MCP 需要单独安装或通过环境变量指向。换机步骤：

```bash
# 1) 安装两个必需 MCP（可放在任意目录，不要求与本插件同目录）
git clone https://github.com/SIFU-YE/cpt-mcp.git
cd cpt-mcp && npm install && npm install -g .

git clone https://github.com/SIFU-YE/fr-docx-mcp.git
cd fr-docs-mcp && npm install && npm install -g .

# 2) 安装本插件
dsh plugin --profile <profile> add git+https://github.com/SIFU-YE/dsh-report-mode.git

# 3) 检查外部命令是否可见
npm run check:runtime
```

如果命令装在非标准位置、PATH 上没有，在 `<DSH_HOME>/.env` 中写：

```ini
REPORT_CPT_MCP_COMMAND=<cpt-mcp可执行文件或启动入口>
REPORT_FR_DOCS_MCP_COMMAND=<fr-docs-mcp可执行文件或启动入口>
CPT_MCP_ALLOWED_ROOTS=./你的报表工作区
```

`dsh-report-mode` 的预设通过 `REPORT_*` 环境变量解耦具体安装路径；`cpt-mcp` 和
`fr-docx-mcp` 本身不依赖本仓库位置。`install/install.ps1` 优先使用 `DSH_HOME`，没有时回退
`~/.dsh`。

报表模式不再安装 `dsh-report-git`，也不需要 Gitee/GitHub 推送凭据；本地 git
工具已 vendored 进本包（`lib/local-git`），不再依赖 host 级 `dsh-plugin-git-workflow`。

> **团队模式已下线（0.1.23 起）**：预设不再注册 `@nanmicoder/dsh-agent-teams`，因此安装
> 步骤里**没有**"装原版 AgentTeams + 打补丁"这两步。`patches/` 与
> `tools/apply-patch.mjs` 作为历史资产保留，只有你要恢复团队模式时才按 `docs/INSTALL.md` 用。

补丁工具（可选）支持四种模式：`check`（缺省，只体检）/ `apply` / `verify` / `revert`，
`--dry-run` 可配合 `apply`、`revert` 做零副作用演练。

---

## 5. 仓库结构

```
package.json                  插件清单：dsh.bundle.patch + dsh.client（浏览器半区）
                              files 必须含 cordis.patch.yml，否则打包后 dsh 读不到 overlay
cordis.patch.yml              本插件对 host 组合的全部贡献（插件行 + preset-report-mode 声明 + AgentTeams 配置层适配）
lib/index.js                  插件入口：组装下面两件事
lib/bootstrap.js              预设目录自举（0.2.0 起已停用）+ AgentTeams 补丁体检
client/index.js               浏览器半区：队长会话背景/角标（__ModuleLoader__ 自注册 bundle，不能用顶层 export）
presets/report-mode/          预设源文件（agent.cordis.yml + preset.yml）——声明行的 plugins 由此迁移
packages/dsh-coding-preset/   伴随包：个人「编码（Git Bash）」预设的声明行（独立安装，
                              不进本插件 tarball——files 不含 packages/）
patches/                      补丁文件 + manifest.json（版本锁与哈希）
tools/apply-patch.mjs         补丁执行器（自带 unified-diff 应用器）
scripts/scan-secrets.mjs      发布前门禁：密钥 + 可迁移性（命中即拒绝发布）
config/report-mode.env.example 环境变量模板
install/install.ps1           一键安装/升级脚本
docs/INSTALL.md               安装与从 fork 迁移
docs/PATCH.md                 补丁内容、边界与上游升版后的重新生成流程
```

---

## 6. 安全边界

- **凭据**：只在 `<DSH_HOME>/.env`。仓库里任何地方都没有口令，`scripts/scan-secrets.mjs`
  会把本机历史口令、内网主机名、Windows 用户目录绝对路径，以及**盘符绝对路径 / 固定
  Program Files 安装位置**（可迁移性）都当作命中项；占位符（`<DSH_HOME>`、`<盘符>`）与
  `!!js process.env.*` 写法不算命中。
- **报表产物不上云**：报表模式不注册 push / 建远端工具；旧版 `dsh-report-git` 的推送/远端
  工具被 deny，也不使用 Gitee/GitHub 凭据； `.cpt`、SQL、样例与 `sandbox*` 历史数据只做
  本地提交。若代码任务需要上传，使用任务代码仓库（GitHub）的 git 配置，与本预设的报表产物
  策略分离。
- **私有 ≠ 安全**：私有仓库可能被分享、镜像、协作者 clone，所以凭据一律不进仓库。
- **补丁进 `node_modules`**：`apply-patch.mjs` 有版本锁——目标包版本或文件哈希与
  `patches/manifest.json` 不符就**拒绝执行**并报出差异，不会"尽力而为"地覆盖上游改动。
  随时可用 `--mode revert` 恢复原版。
- **预设是声明行，不写用户目录**：预设由 `cordis.patch.yml` 的 `@deepseek-ai/dsh-agent-preset`
  声明行提供，不碰 `$DSH_HOME/.agent-presets/`，因此不会覆盖任何你自己手写的预设。
  （旧的目录自举逻辑仍在 `lib/bootstrap.js`，但 0.2.0 上默认 `presetAutoInstall: false`
  停用——0.2.0 根本不读那个目录，写进去也没有意义。）

---

## 7. 已知限制

- 补丁作用于 `node_modules`，因此**每次重新安装/升级 AgentTeams 都要重新打补丁**；
  升级到非 0.1.20 的版本时补丁工具会先拒绝，需要按 `docs/PATCH.md` 重新生成。
  长期方向是把 A/B/C 三项推成上游开关，让补丁最终归零（见 `docs/PATCH.md` 末节）。
- `apply-patch.mjs` 是 node 脚本，需要自己跑一次；不做成 postinstall 是因为
  DSH 的 profile 用 pnpm 且只放行 `node-pty` 的构建脚本，postinstall 会被拦掉。
- 报表模式的 MCP 服务器（cpt-mcp / fr-docx-mcp / mysql-mcp-server /
  chrome-devtools-mcp / excel-tools-mcp）都是**外部依赖**，本仓库不内置、不锁定它们的
  实现；0.1.31 起 browser 入口钉 `chrome-devtools-mcp@1.12.0`，换机/清缓存后首次启动
  可能需要联网或用 `REPORT_BROWSER_MCP_ENTRY` 指向本机已有入口。
- **浏览器网络层 allowlist 依赖 Chrome 149+**：mcp-browser 的 `--allowedUrlPattern`
  （拦子资源 / `evaluate_script` 内 `fetch`）是 Chrome 149 起的能力；本机 Chrome 156
  实测可用。换机器若 Chrome < 149，该参数可能让 MCP 启动失败——升级 Chrome，或临时
  用 `REPORT_BROWSER_MCP_ENTRY` 指回旧入口并删掉预设里的 `--allowedUrlPattern` 段
  （此时只剩工具层 guard，`evaluate_script` 内的网络访问不再被硬拦）。
- **旧目录式预设在 DSH 0.2.0 上已失效**：`$DSH_HOME/.agent-presets/<id>/`
  （`preset.yml` + `agent.cordis.yml`）0.2.0 起不被读取，预设必须以
  `@deepseek-ai/dsh-agent-preset` 声明行随 bundle patch 下发。本包已按此迁移；
  手上还有旧目录式预设的话，迁移步骤见 `docs/INSTALL.md`（**注意逐个核对插件名**，
  上游改名的包会在激活时失败——例如 workflow 后端已从
  `@deepseek-ai/dsh-workflow-worker-thread` 改名为 `@deepseek-ai/dsh-workflow-ptc`）。
- **client 半区必须是 `__ModuleLoader__` 自注册 bundle**：DSH 把
  `exports["./client"]` 的文件字节原样拼进一个经典 `<script>`，顶层 `export` 会让整段
  combo `SyntaxError`，连累同组其它插件一起不激活（`web boot: N entries did not activate`）。

## 许可证

MIT，见 [`LICENSE`](LICENSE)。

## License

MIT License。见 [`LICENSE`](./LICENSE)。

