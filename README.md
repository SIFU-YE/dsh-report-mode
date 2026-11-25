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

> **0.1.51 修复（生产报障回归）**：此前主路径误调 `shell.run()`，而宿主 shell 服务的
> 公开契约是 `resolve(request)` → `execute(spec)` → `handle.result()`，导致报表模式下
> 六个 git 工具全部报 `shell.run is not a function`；同时主路径失败不返回 `message`，
> 报错信息为空。现已修正，并补上「走 shell 主路径」的回归测试（此前测试只覆盖无 shell
> 的兜底路径，所以门禁一直是绿的）。

### 预设 `report-mode`（在预设选择器里出现「报表模式」）

- MCP 服务器（7 个）：`cpt-mcp`、`fr-docx-mcp`、`doris`、`mysql`、`testdb`、`browser`、`excel`
- 本地工具：`read/write/edit`、`glob/grep`、`ask_user_question`、`todo`、`subagent`、
  `delete_file`（0.1.28 起内置，预设内 scoped 行：**仅报表模式可见**；默认移入同级
  `.trash`，`use_trash:false` 才硬删；工作区外与受保护路径段拒绝）、
  `copy_file`（0.1.54 起内置，预设内 scoped 行：**仅报表模式可见**；二进制安全复制，
  `fs.copyFile` 不过文本编解码，供 `.cpt` 改前备份；缺省生成同目录
  `<原名>.bak-YYYYMMDD-HHmmss.<扩展名>`，目标已存在须显式 `overwrite:true`；
  与 `delete_file` 共用工作区/受保护路径段判定）
- 工具护栏（预设内 scoped 行，`restrict` 隐藏 schema + `guard` 调用时拒绝，0.1.31 起；
  0.1.49 起加**命中即补隐藏**——guard 拒绝某名字时立即补一次该名字的 restrict，事件驱动覆盖
  任何晚注册时序，固定 1500/5000ms 重试窗退为兜底）：
  - host 级 `mcp-toolbox` 的 3 个 query 工具、host 团队工具
    （`spawn_teammate` / `wait_agent` / `team_task_*`）在报表模式被 deny；
  - 内置本地 git 工具（`git_init` / `git_status` / `git_diff` / `git_log` / `git_commit` /
    `git_branch`）：报表产物只做本地提交；它们没有 push / 远端能力；
  - 旧版 `dsh-report-git` 的六个工具（`git_commit_all` / `git_repo_status` /
    `git_rollback` / `git_link_remote` / `git_fetch` / `git_pull`）在报表模式被 deny：
    即使旧会话或残留 host 组合仍注册了它们，调用也会被 guard 拒绝，不能借此推送 Gitee；
  - 宿主记忆插件的 27 个 MCP 工具在报表模式收窄为 7 个（0.1.49 起）：保留
    `find / search / read / list / tree / remember / rule_search`；其余 20 个（导入外部
    资源、viking 文件面、凭据与账号管理、跨 MCP 代理、订阅/诊断，schema 实测 ≈35KB/会话）
    被 deny——persona 第 1 条「写入先脱敏」由规则约束升级为工具层强制；宿主未装该插件时
    fail-open 零影响；
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
- 宿主层伴随能力（非本插件提供，`restrict` 只针对团队工具）：报表模式**不自己注册**
  跨会话记忆/技能服务；宿主 profile 若装了记忆类 bundle（例如 `@openviking/dsh-memory-plugin`），
  其注入与检索结果会进入会话。persona 的边界是：**记忆只作参考**，项目规则与本次核验优先，
  不得把记忆当作业务依据；**写入/总结记忆前必须脱敏**（生产凭据、真实姓名、手机号、
  内网主机、对象存储桶名等禁止写入，与第 5 条一致）。0.1.49 起其工具面在报表模式收窄为
  检索/浏览/里程碑写入/项目规则 7 个工具（见上方工具护栏清单）。换机若宿主未装该类 bundle，
  本预设不因缺少它而失效——只是没有跨会话记忆。

刻意**不给**：shell、公网、后台任务、跨会话记忆服务本体（宿主若提供，按上面边界只作参考）。

### 长期运维报表的跨会话连续性（SOP）

复杂报表长期反复改配置时，`/compact` 压缩或更换模型会让**会话内**上下文失真
（模型回不起已做过的改动，语义漂移）。宿主装了记忆类 bundle（如
`@openviking/dsh-memory-plugin`）时，本预设与它配合的连续性机制——链路已逐环节核验：

| 环节 | 机制（核验位置） |
| --- | --- |
| 压缩前抢救 | DSH 在 `/compact` 前先发 `compaction/start` 事件；记忆插件在此时点**先整段提交会话再允许历史被改写**（`runtime.mjs` `maybeCommit` 的 boundary 分支；DSH 核心事件类型已在 app.asar 源里核验） |
| 长会话中途 | 每轮 `turn/end` 检查未提交 token，超过阈值（`~/.openviking/ovcli.conf` 的 `commitTokenThreshold`，当前 60000）就增量提交——不用等压缩 |
| 会话结束/换模型开新会话 | 会话销毁时 shutdown commit；新会话首轮由下面的恢复机制接管 |
| 恢复 | 记忆插件挂在 `agent/pre-step`：**每个新回合**都按当前提问检索记忆并注入 `<openviking-context>`（不是只在会话开头）；persona 第 13 条要求模型接手/续做时先恢复「已改动清单、验证结论、遗留问题、下一步」，并与当前文件、本地 git 历史核对后才能继续 |

配套纪律（persona 第 1、13 条）：记忆**只作参考**、写前**脱敏**；每批已验证改动写
**精炼里程碑**（报表标识、意图与改动点、验证结论含未验证项、遗留问题与下一步），
不写过程流水账。

记忆命名空间跟随**工作区本地 git 仓库根**（本机路径派生）：报表工作区按第 9 条
初始化本地仓库后，该报表的历史记忆有独立命名空间；注意**目录改名/搬迁会换命名空间**
——旧记忆仍在用户根下，无 target 的语义检索默认跨 peer 扫描仍可命中，但精确度会降，
搬迁前可先导出/记录关键里程碑。

两条互补的**会话内**连续性通道（与上面跨会话记忆叠加使用）：

- `/goal`（0.1.47 起）：跨轮目标由宿主目标机制在每轮重申，**会话内 `/compact` 后不丢**
  （目标状态由 goal-round 驱动保留，压缩摘要不会覆盖它）；跨会话则回到上面的记忆链路。
- plan mode：大改造先出完整计划并确认，计划本身也是可恢复的中间产物。

### 报表工作区的自动抽取节奏（工作区级配置，与预设解耦）

宿主记忆插件的链路是「捕获 → 按阈值提交 → 服务端抽取」，三段实测结论：捕获与抽取都正常，
**断点在提交节奏**——`ovcli.conf` 全局 `plugin.dsh.commitTokenThreshold=60000`（用户降本
策略），报表会话常常攒不到阈值，内容长期 pending 未提交，表现出来就是「报表模式不会自动
抽取录入记忆」。修复不动预设代码、也不动全局降本值，用插件**原生的工作区级覆盖面**：

把 `config/openviking-workspace.example.json`（内容如下）放进报表工作区根目录的
`.openviking/config.json`：

```json
{
  "version": 1,
  "capture": {
    "commit_token_threshold": 15000
  }
}
```

- 只影响放了该文件的工作区；没放的工作区维持全局 60000（2026-11-21 已放入
  `某会话` / `某会话` / `某会话` 三个活跃报表工作区，`某会话` 因会话多为子代理
  批次刻意未放）。
- **文件形状陷阱（实测踩过）**：键必须是嵌套对象——顶层平铺写成
  `"capture.commit_token_threshold": 15000` 会被插件**静默忽略**。
- git 工作区放在仓库根；非 git 目录放了该文件即自动成为工作区根（记忆落入用户级命名空间）。
- **生效时机是会话开始时的配置快照**：正在跑的会话要等 `/compact`（压缩边界必然提交）或
  宿主重启才吃到新阈值；新会话立即生效。删文件即回退全局值。
- 解耦边界不变：本仓库只提供这份文档与示例模板，不引入任何代码依赖；宿主未装记忆类
  bundle 时该文件无害、无效果。


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

### 报表模式（PTC）实验变体（0.1.50 未发布起）

同源派生的第二个预设「报表模式（PTC）」（`presets/report-ptc/agent.cordis.yml` → 镜像行
`preset-report-ptc`）：与报表模式相同的 persona 与全部工具护栏，另挂一行
`@deepseek-ai/dsh-agent-tool-presentation {mode: both}`——**原生工具 schema 全部保留，
另加 `run_code` + 生成的 TypeScript SDK**。用途：把「同类工具操作 ≥5 次 / 固定多步序列」
写成一段程序批量完成，中间结果留在程序内不进对话（cpt-mcp 侧配方：
`get_capabilities({section:"ptc.recipes"})`）。

- 实证动因：某会话/v1 会话 109 次调用中 57 次为参数循环（`add_cell`×34、
  `add_fill_binding`×23）——PTC 把这类循环折叠成 1 轮对话；
- 选择器形态沿用 ptc-ab A/B 实验设计：运行时未就绪时**优雅回退 native**（不阻断启动）；
  若新会话里 `run_code` 未出现，说明宿主未组合 `dsh-ptc-runtime-node`，按该包 README 补挂
  运行时行后重启即可（官方已建议新配置直挂 `dsh-tool-executor-ptc`，本实验刻意选择
  both + 回退语义以保 A/B 安全）；
- A/B 量化：用本机 system 工作区的 `ptc-ab` 验收包（三任务设计 + 计数脚本，不入本仓），
  建议新增 T4 = 复现 v1 的 34+23 循环任务；拍板规则建议：PTC 组轮次 ≤3 且 token ≤
  native 组 40% 且门禁结论等价，再考虑默认切换或常驻双轨；
- 派生纪律：改动先改 `presets/report-mode/agent.cordis.yml`，再跑
  `node scripts/derive-report-ptc.mjs` 重新派生（变体三处受控差异见文件头注释）；
- 移除变体：删掉 `cordis.patch.yml` 的 `preset-report-ptc` insert 块与
  `presets/report-ptc/` 目录即可，默认报表模式不受影响。

### 按需代码执行租约（0.1.50 起，默认关闭）

报表模式默认「无 shell、无公网」。但有一类任务绕不过计算：把几百行、二十几列的本地
Excel 解析后生成可一键导入的 SQL，或批量核对口径——靠「看一眼再手写」必然出错。此前
这类任务只能退化成「给用户一段本地脚本自己跑」，模型并没有真正完成任务。

0.1.50 起提供**按需**通道，仍然是「默认关闭」：

- **常态**：只注册 `request_code_access` / `release_code_access` 两个无危险工具；
  执行工具 `run_script` **不在 tools/list 里**。
- **申请**：用户明确同意后，模型调用 `request_code_access`（必须带 `reason` 与
  `confirm=true`），按会话授予 1–30 分钟租约（默认 10），此时才**动态注册**
  `run_script`；不同意或没传 `confirm` 一律拒绝。
- **执行**：node / python 二选一，cwd = 会话工作区；环境只透传运行时白名单变量
  （**不透传任何 harness / MCP / 业务凭据**），代理变量指向不可达端口做尽力阻断；
  代码 ≤200KB、超时 ≤120s、输出有上限；临时脚本写系统临时目录、**执行后立即删除**。
- **释放**：`release_code_access` 立即注销 `run_script`；租约到期自动注销。
- **护栏**：代码文本出现 `.env`、实例键文件、`~/.ssh`、云配置等凭据特征时直接拒绝执行。

实现分两层：`lib/code-access-core.mjs`（租约状态机、环境清洗、护栏、进程执行，无宿主
依赖、可单测）与 `lib/code-access.mjs`（subpath `dsh-report-mode/code-access`，只做
schema 与 `ctx.tools.register` 接线）。测试见 `test/code-access.test.mjs`；仓库门禁覆盖
「常态不注册 `run_script`」「凭据不透传」等回归。

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

