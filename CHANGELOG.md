# Changelog

本仓库遵循语义化版本；报表模式的每一次对外可见变更都记在这里。

## 0.1.48 — 报表模式彻底切断 Gitee 推送入口（2026-11-11）

- 修正 `restrict-host-git`：不再误拦截内置 local-git 的 `git_status` / `git_diff` / `git_log` / `git_commit` / `git_branch`，改为强制 deny 旧版 `dsh-report-git` 的六个推送/远端工具（`git_commit_all` / `git_repo_status` / `git_rollback` / `git_link_remote` / `git_fetch` / `git_pull`）；
- 即使旧会话或残留 host 组合仍注册这些工具，guard 也会在调用时拒绝；报表模式只保留内置 local-git 本地提交（init/status/diff/log/commit/branch）；
- persona 规则 9 明确禁止使用任何 push / 关联远端 / fetch / pull 的 git 工具，删除报表模式内的代码仓库推送例外；
- cpt-mcp 在报表模式显式设置 `CPT_MCP_ALLOW_PUSH=0`；用户级 `CPT_MCP_ALLOW_PUSH` 同步改为 0；
- README / INSTALL 更新“报表产物只落本地仓库”的护栏说明；
- 版本号 0.1.48。

## 0.1.47 — 报表模式增加目标与计划能力（2026-11-11）

- 报表模式挂载 `command-goal` / `tool-goal`：支持 `/goal` 与 `goal` 工具，承载跨轮、多步骤的报表改造目标；
- 报表模式挂载 `planning` / `@deepseek-ai/dsh-plan-mode`：先出完整计划，经 `exit_plan_mode` 确认后再执行，计划阶段禁止修改文件；
- persona 增加约束：多步骤或创造性报表任务先建立目标与计划，计划确认前不改文件；
- README / INSTALL 更新目标与计划能力说明；
- 版本号 0.1.47。

## 0.1.46 — 报表模式内置 git 支持本地建仓（2026-11-11）

- `lib/local-git` 新增 `git_init`：工作区没有 `.git` 时用内置本地 git 工具初始化仓库（默认分支 `main`，不建远端、不 push）；
- 修复 git 工具失败时返回 `exitCode: null` 被 DSH 输出 schema 拒绝的问题（`value.exitCode must be a number`）；失败统一返回数字退出码，模型可以看到真实错误信息；
- persona 规则 9 明确：工作区尚未建仓时先初始化本地仓库，再做本地提交；
- README / INSTALL 更新内置 git 工具清单（init/status/diff/log/commit/branch）；
- 版本号 0.1.46。

## 0.1.45 — 会话提示词加入推送前敏感信息检查（2026-11-10）

- report-mode persona 与 coding preset 都加入硬约束：推送 dsh-report-mode / cpt-mcp 仓库前必须运行对应仓库的敏感信息扫描并全部通过，禁止 `--no-verify` 绕过；
- 扫描门禁增加真实手机号、身份证号、非示例邮箱检测；命中输出不再回显原文，只报文件/行/规则；
- 新增仓库级 `AGENTS.md`，固化“扫描通过后才能提交/推送”的纪律；
- 版本号 0.1.45。

## 0.1.44 — 开源元数据与 DSH_HOME 文档修正（2026-11-10）

- README 安装示例改用 `${DSH_HOME:-$HOME/.dsh}`，适配不同 DSH 安装位置；
- package.json 补充 repository；版本号 0.1.44；
- 继续保留 0.1.43 的外部 MCP 命令覆盖与 `check:runtime`。

## 0.1.43 — 可迁移性：外部 MCP 命令/DSH_HOME 环境变量化（2026-11-10）

- cpt-mcp / fr-docs-mcp 命令支持 `REPORT_CPT_MCP_COMMAND` / `REPORT_FR_DOCS_MCP_COMMAND`
  覆盖，非标准安装位置不再需要改预设；
- 新增 `npm run check:runtime` 前置检查，换机后先确认外部 MCP 命令可见；
- `install/install.ps1` 优先读取 `DSH_HOME`，回退 `~/.dsh`，支持不同 DSH 安装位置；
- README/INSTALL 增加“迁移到其他电脑 / 不同 DSH 安装位置”步骤；
- 移除 package `files` 中不再随公开快照分发的 CHANGELOG；
- 本地 git 仍为内置实现，不依赖 host `dsh-plugin-git-workflow` / `dsh-report-git`。

## 0.1.42 — 内置本地 git：报表模式不再依赖 host git 插件（2026-11-09）

按「报表产物只留本地 + 减少外部插件依赖」调整：

- 把 `dsh-plugin-git-workflow` 的 5 个本地工具 vendored 进本包
  `lib/local-git/`（MIT，保留许可与来源说明）；
- 预设新增 scoped 行 `report-local-git`（`dsh-report-mode/local-git`）：
  `git_status` / `git_diff` / `git_log` / `git_commit` / `git_branch`，无 push/远端；
- profile 不再需要 host 级 `dsh-plugin-git-workflow` bundle（否则同名工具双注册）；
- 版本 `0.1.41` → `0.1.42`。

## 0.1.41 — 报表产物只落本地 git，不接云端（2026-11-09）

按用户要求调整报表模式 git 边界：

- 移除 `dsh-report-git` scoped row（不再有 push / 建远端 / fetch / pull 工具）；
- 不再 deny host 级 `dsh-plugin-git-workflow`：改用它的本地工具
  `git_status` / `git_diff` / `git_log` / `git_commit` / `git_branch`，只做本地提交；
- persona 第 9 条改为：不 push、不建远端、不上传云端；`sandbox*` 历史数据只留在本地仓库；
- 同步 README / env 模板：移除 Gitee 凭据与推送说明；
- 版本 `0.1.40` → `0.1.41`。

## 0.1.40 — persona 去 MCP 化：报表模式 / cpt-mcp / fr-docx-mcp 解耦（2026-11-09）

按目标架构重构报表模式 persona：**报表模式只定义身份、模式级安全/交付约束与工作方式**；
不再包含任何显式 MCP 使用提示（不点名 cpt-mcp / fr-docx-mcp、不写工具名/参数/调用序列）。

- 删除 persona 中约 32KB 的 cpt-mcp 工具协议、SQL 测试流程、JS 规则、质量门禁、
  fr-docx 工具用法、doris/mysql/testdb 工具名、Excel 工具名、git 工具名等；
- 改为泛化原则：已挂载能力以运行时 `tools/list` 与各自服务说明（instructions/schema）为准；
  报表模式只保留模式级硬约束（无 shell/公网/团队/记忆、本地预览、生产只读、文件保护、
  交付复核、git 纪律）与领域工作方式；
- 新增 persona 测试：禁止 `mcp__`、具体 MCP 名、工具名与调用序列；保留安全锚点；
- 版本 `0.1.39` → `0.1.40`。各 MCP 必须自描述；fr-docx-mcp 补 server instructions（独立仓库）。

## 0.1.39 — 预览本地连接自动写入 + quality_gate 运行期可见（2026-11-09）

cpt-mcp 继续完善测试环境闭环，报表模式同步提示词：

- `start_fr_preview` 的 `localTest` 缺省 true：cpt-mcp 启动前清空 finedb 外部连接，并自动写入
  `local_db_import({action:"report"})` 的本地 SQLite 连接；缺库/缺表返回
  `local-test-env-not-ready`，不再要求用户手工到 adminUrl 配连接。
- `quality_gate_cpt` 对填报模板返回 `fillRuntime=unverified`（info advisory，不改
  pass/blockers/deliveryPass），persona 第 4/8 条同步要求按运行期实点。
- 版本 `0.1.38` → `0.1.39`。

## 0.1.38 — 报表模式对齐 cpt-mcp 报表测试环境与生产隔离（2026-11-09）

cpt-mcp 2026-11-09 新增 `local_db_import({action:"report"})` 与 FR 预览外部连接硬拦截；
报表模式只更新提示词与版本，不复制 cpt-mcp 实现：

- 「数据集 SQL 本地测试协议」第 3 步新增：修改已有报表优先 `action:"report"`，自动扫描
  **全部数据集连接 + 填报提交目标表**（列映射 / 自由 SQL 写表），只读镜像 schema+按需抽样；
  新报表用 `ddl/table/rows` fixture；不要只用 `action:"auto"` 漏掉填报目标表。
- 新增第 8 条「生产隔离与运行期」：生产数据只允许 MCP 只读读取并导入内置 SQLite；
  `start_fr_preview` 发现 `jdbc:mysql`/Doris 等外部 URL 会拒绝启动，预览数据连接只配
  `action:"report"` 返回的 `preview.connections`（本地 `jdbc:sqlite`）；填报/工具栏/JS
  必须在 `writeUrl` 实点，SQLite 通过 ≠ 运行期通过。
- 「cpt-mcp 主动调用协议」2.c 增加：填报类在 deliveryPass 之外还须完成测试协议第 8 条运行期点检。
- 版本 `0.1.37` → `0.1.38`；需跑 `sync-preset.mjs`、安装/热更新后新会话生效。

## 0.1.37 — 报表模式提示词对齐 cpt-mcp 测试环境改造（2026-11-04）

cpt-mcp 2026-11-04 完成测试模块改造（`dsh-report-mode` 只改提示词、不改运行逻辑）：
`run_dataset_sql_check` 的 `target` 缺省从 `real` 改为 `local`（测试环境口径，真实库须显式
`target:"real"`）；`local_db_import` 新增 `action:"auto"`（镜像 schema + 按需抽样，默认
≤200 行/表、≤5000 行合计）与 `action:"excel"`（Excel 导入离线仿真：位置匹配/列位/表头/控件类型/
本地目标表约束，事务试插后必回滚）；`quality_gate_cpt` 本地库未建时给 info advisory + nextAction。

- persona「数据集 SQL 本地测试协议」改为新口径：缺省 target=local、真实库显式；本地库准备优先
  `local_db_import({action:"auto"})`；保留 `target:"real"` 对账与「公式参数先展开」「本地通过≠生产通过」等既有铁律。
- persona「Excel 读取」新增第 5 条：模板配「导入Excel」按钮（import-append/import-clean）时，
  交付前必须跑 `local_db_import({action:"excel", ...})` 离线预检；明确它不执行
  before/afterimportexcel 前端 JS，离线通过 ≠ FR 页面行为通过。
- 版本 `0.1.36` → `0.1.37`；`npm test`（scan-secrets + sync-preset --check + host-guards）通过；
  仅改源仓库，未安装/重启（等用户授权后热更新）。

## 0.1.36 — 修复 persona 变量插值回归（`{{...}}`）

0.1.33 的 persona 写了字面 `{{...}}`，DSH 把它当成 prompt variable 解析，报表模式启动报
`malformed prompt variable reference "{{...}}" in section "deployment:persona-prefix"`。
0.1.34/0.1.35 未覆盖这一行；本次只改占位符写法为 `[占位符]`，不改变任何业务规则，
版本 `0.1.35` → `0.1.36`。

## 0.1.35 — 按 cpt-mcp 落地 API 收尾 persona（设计器转义 / blocks 口径 / 基线复位）

0.1.34 的三条 JS 规则当时写成条件式（cpt-mcp 侧尚未落地）。cpt-mcp 已完成三项修复并推送，
本次把 persona 的条件式收尾为具体参数名与返回字段（仍只改提示词，不改运行逻辑）：

- cpt-mcp 侧落地提交：`d7313d4`（check_report_js / js-baseline 覆盖模板级 `<ReportWebAttr>`
  WebPageContent / WebViewContent 事件与 page/view 工具栏）→ `1cd48a1`（读 JS 工具与 check_report_js
  暴露 `]A` 元数据与铁律）→ `7788031`（validate_cpt / quality_gate_cpt 新增 `resetJsBaseline` 复位开关）。
- **R-A 收尾**：读 JS 出口（`get_webwrite_js` / `get_report_listener(_batch)` / `get_cell_listener` /
  `get_cells` 的 listeners / `get_cell_hyperlink` script）在原文含 `]A` 时返回
  `designerEscapes{marker:"]A", count, hint}`（聚合出口另带 `blocks`；无标记时无此字段，原文不变）；
  `check_report_js` 返回 `designerMarkers{total, blocksWithMarkers}` 且 hint 说明「解析前已解码、不是缺陷」。
  persona 改为按元数据理解、不 strip、不把标记数当缺陷、不据此改块。
- **R-B 收尾**：blocks 覆盖补模板级 `<ReportWebAttr>` 的 WebPageContent（分页预览）/ WebViewContent
  事件与模板级 page/view 宿主工具栏；注明 2026-11-03 审计的「模板级事件漏扫」缺口已修（同一模板
  blocks 5→6），不得再把「模板级分页/视图事件未覆盖」当能力缺口。
- **R-C 收尾**：明确复位开关 `validate_cpt({path, resetJsBaseline:true})` /
  `quality_gate_cpt({path, resetJsBaseline:true})`，返回 `baselineReset:true` 与
  `baselineResetInfo{hadBaseline, previous:{total,byCat}, current:{total,byCat}, hint}`；只复位本模板
  那一条基线；只在本模板 JS 块确属有意删减时使用，复位后必须重跑 validate_cpt / quality_gate_cpt
  确认 blocker 清零，不得把复位当交付结论。
- 版本 `0.1.34` → `0.1.35`；`npm test`（scan-secrets + sync-preset --check + host-guards）通过；
  重新装配 desktop profile 并核对 SHA256。

## 0.1.34 — 报表 JS 检查口径与设计器转义（2026-11-03 会话审计）

2026-11-03 09:00–12:00 的真实报表会话又暴露三类反复错误（其中一类是用户第三次纠正同一误判）。
本次只改 persona 提示词，不改运行逻辑：

- **设计器转义 `]A` 不是污染（P0）**：读回的 JS 里出现的 `]A` 是 FineReport 设计器对 `]` 的正常
  落盘转义，不是残字符 / 乱码 / 污染。persona 明令：禁止据此删改、strip、整块覆盖 JS，也禁止为此
  裸改 .cpt XML；语法是否有效只以 `check_report_js` 判定（工具按设计器口径解码 `]A`→`]` 后再解析）；
  工具返回体带 `designerEscapes` 元数据时按元数据理解，不自行 strip。
  证据：2026-11-03 10:56（本地）sandbox4 会话 `session-de4f833e`，模型把读回 JS 里的 `]A` 当
  「不可见残字符 / 污染」，整块重写按钮 JS 并提交，被用户纠正后回退；用户原话：
  「A 是设计器自带的标记语言不会影响代码正常运行」。此前同类事故：10-27 裸改 .cpt 抹掉 259 处 `]A`、
  10-31 sandbox4 V3 按钮 JS 整块覆盖。
- **`check_report_js` 的 blocks 口径（P1）**：persona 写明 blocks 覆盖 TopJS / 报表事件 / 填报事件
  （含模板级 WebWriteContent）/ 分页预览事件 / 单元格事件与按钮 JS / 工具栏按钮 JS / 超链 JS；
  块数与预期不符时先看 `failures` / `locations`（及 `designerMarkers` 等明细）逐块核对，
  **不得仅凭块数不符就下「工具没解析某类 JS」的结论**，确属能力缺口再按前文规则明确报告「工具缺 X」。
  证据：2026-11-03 10:55 sandbox4 同一会话，模型见 `blocks=5` 而模板原始 `<JavaScript>` 节点 6 个，
  即断言「check_report_js 没有解析工具栏按钮 JS」；cpt-mcp 探针复核确认工具栏按钮 JS 已解析，
  实际缺的是模板级 `<ReportWebAttr><WebPageContent>` 事件（cpt-mcp 侧另行修复）。
- **js-baseline 陈旧基线处置（P1）**：persona 写明基线库在 `%LOCALAPPDATA%\cpt-mcp\js-baseline`
  （工作区外，`delete_file` 会拒绝，不要删、不要裸改文件、不要按 `validate_cpt` fix 文案去删基线文件，
  也不要让用户手工删）；经 cpt-mcp 写入工具删块会自动刷新基线；外部有意删减导致
  `validate_cpt` / `quality_gate_cpt` 报 JS 块数基线 blocker 时，优先用工具提供的基线复位能力
  （工具 schema 若提供 `resetJsBaseline` 之类的复位参数，按实际参数名传，如
  `quality_gate_cpt({resetJsBaseline:true})`），复位后重跑校验；工具没有复位能力时明确报告
  「缺 js-baseline 复位能力」并请用户决定，不得把 blocker 当已解决继续交付，也不得绕过质量门禁。
  证据：2026-11-03 11:49:45 sandbox16 会话 `session-b9ea67ca`，模型试图删除
  `js-baseline\<sha1>.json` 解除门禁 blocker，被「路径在工作区外」拒绝后只能绕行。

版本 `0.1.33` → `0.1.34`；`npm test`（scan-secrets + sync-preset --check + host-guards）通过。

## 0.1.33 — 2026-11-03 会话教训写进 persona

0.1.32 后的真实会话暴露出四类反复错误，本次只改提示词、不改运行逻辑：

- **子代理自述不能当验收**：子代理/历史会话的“已完成/已修复/已验证”不再被当作交付证据；
  主 agent 必须亲自重跑 `check_report_js` / `validate_cpt` / `quality_gate_cpt`（必要时
  `verify_cpt({engine:true})`），汇报里写工具名与时间/关键字段。
- **本地 SQL 候选必须是可执行 SQL**：模板原文的 `${if(...)}` 等公式参数先展开成空分支/真实值，
  再传 `run_dataset_sql_check({target:"local"|"both"})`；直接传原文会拼出 `WHERE 1=1 NULL`
  之类的假语法错。`autoTables:true` 已改为递归扫描任意深度 `FROM/JOIN`（含 EXISTS/子查询/CTE/UNION），
  漏表先重跑 schema，不把“本地缺表”误判成模板 SQL 错。
- **工具能力不足不许绕行**：`set_toolbar_button_js` 等没有 sheet 级定位时，禁止用
  `update_report_node`、删后重建或手改 XML 绕过；明确报告能力缺口并给设计器精确步骤。
- **交付判定统一为三态**：`blockers=0` 且 `pass/structuralPass=true` 且 `deliveryPass=true`
  才可宣告完成；只跑静态检查/只看 `pass` 不算交付。

cpt-mcp 的 `CPT_MCP_INSTRUCTIONS`、`run_dataset_sql_check`、`local_db_import` 与
`get_capabilities().workflow.localSqlTest` 已同步同一口径；版本 `0.1.32` → `0.1.33`。

## 0.1.32 — 浏览器网络层硬限制（allowedUrlPattern）

0.1.31 的 guard 只能拦 `navigate_page` / `new_page` 的 URL；页面内 `fetch` / `WebSocket` /
`location.href` 以及子资源仍可能出公网。0.1.32 在 chrome-devtools-mcp 启动参数里增加
`--allowedUrlPattern`，由浏览器网络层统一限制：

- pattern：`http(s)://localhost:*/*`、`http(s)://127.0.0.1:*/*`、`http(s)://*.localhost:*/*`；
  子资源、重定向、`evaluate_script` 内的网络请求一并拦截；
- 需 Chrome 149+（本机 Chrome 156 实测）；URLPattern 不支持 `[::1]`，故白名单不含 IPv6；
  旧 Chrome 的升级/临时降级说明见 README / INSTALL；
- `guard-browser-local` 白名单同步收窄为 `localhost` / `127.0.0.1` / `*.localhost` /
  `about:blank`，与网络层 pattern 对齐；
- 手动验证：`chrome-devtools-mcp@1.12.0` + 全部 args 可正常 initialize / tools-list（15 工具）；
  本地 `127.0.0.1` 页面与 `fetch("/api")` 子资源正常，`*.localhost` 正常；
  `127.0.0.2`（非白名单）被网络层拦截；全程未访问公网；
- 版本 `0.1.31` → `0.1.32`。

## 0.1.31 — 工具护栏（guard）+ DB 映射修正 + 文档

### 背景

0.1.30 只读复审发现三处运行面问题：
1. `ctx.tools.restrict({ deny })` 只能 deny **已注册**的 global 工具，名字未知会抛错；MCP
   工具是异步注册的（stdio 起来、`tools/list` 回来才有），预设挂载时往往还没注册——0.1.29
   新增的 `restrict-host-toolbox` 因此 fail-open，新会话仍能看到 `mcp__toolbox__*` 三个工具；
2. 真实 `.cpt` 的「外接数据库」是 FineDB 平台库（查 `fine_user` / `fine_department`），
   却被映射到 `REPORT_DORIS_*`；且 Doris 连接缺 `database`（真实 SQL 有未限定表名）；
3. persona 的"只允许本地预览页"仍只是文字约束，浏览器 MCP 实际可打开任意公网 URL。

### 变更

1. **调用时拒绝（guard）**：新增 `lib/host-tool-guard.mjs` 共享 helper，两层实现——
   `restrict()` 降级为 schema 隐藏的 best-effort，强制层改用 `ctx.tools.guard()` 在调用时
   同步拒绝（官方语义：返回字符串即拒绝；与工具注册时序无关；scoped 注册只作用于本预设）。
   - `lib/restrict-host-toolbox.mjs`：3 个 `mcp__toolbox__*` 两层屏蔽；
   - `lib/restrict-host-git.mjs`：5 个 host git-workflow 工具两层屏蔽；
   - 新增 `lib/restrict-host-team.mjs`（预设行 `restrict-host-team`）：deny
     `spawn_teammate` / `wait_agent` / `team_task_create|get|list|update`，保留
     `list_agents` / `send_message` / `interrupt_agent`；
   - 新增 `lib/guard-browser-local.mjs`（预设行 `guard-browser-local`）：
     `mcp__browser__navigate_page`（`type=url` 或带 url）与 `new_page` 的 url 只放行
     `localhost` / `127.0.0.1` / `*.localhost` / `about:blank`，公网 URL 调用时拒绝
     （IPv6 不在白名单，与浏览器网络层 pattern 一致，见第 4 条）；
   - guard 回调对 `ToolExecution` 形状做防御（`name` / `toolName` / `tool.name`、
     `arguments` / `args` / `input` / `parameters`）；`tools.guard` 缺失或异常时 fail-open
     只告警，不阻断预设启动。
2. **DB 映射修正**：`CPT_DB_CONNECTIONS` 不再把「外接数据库」映射到 `REPORT_DORIS_*`；保留
   `Doris`、`填报-读写` / `MySQL`、`testdb` / `测试库` 五名。`REPORT_DORIS_DATABASE` 纳入
   生成器（真实 `.cpt` 的 Doris SQL 有未限定表名，缺默认库会报 No database selected）；
   env 模板说明「外接数据库」（FineDB）、`FRDemo`、`middle读写` 未自动覆盖，需要时用
   `REPORT_CPT_DB_CONNECTIONS` 整串补齐。
3. **persona 修正**：允许清单补 host 内置通用工具 `read_image` / `read_mcp_resource` /
   `list_mcp_resources` / `list_mcp_resource_templates` / `load_workspace_dependencies` /
   `working_directory`；团队段改为"host 团队工具已被 deny"；浏览器段注明本地 URL 由工具层
   guard 强制；数据集 SQL 段补真实库连接名映射与未覆盖名单。
4. **浏览器入口钉版本**：`REPORT_BROWSER_MCP_ENTRY` 缺省改 `chrome-devtools-mcp@1.12.0`
   （本机已缓存），env 模板注明换机/清缓存后首次可能联网。浏览器网络层硬限制见 0.1.32。
5. **文档**：README 修正"host 级六个 git 工具"的过期描述（0.1.27 起为预设内 scoped 行）、
   补护栏说明与"安装/升级必须完整重启 DSH"；INSTALL 补 dsh-report-git 必须
   `set_bundle enabled:false`、`sync:preset`、`CPT_DB_CONNECTIONS` / `REPORT_DORIS_DATABASE`、
   护栏验收项；CHANGELOG 修正 0.1.30 已过期的"历史仍需重写"说明。
6. **测试**：新增 `test/host-guards.test.mjs`（fake ctx 覆盖 team / toolbox / git / browser 的
   deny 与 allow、restrict 失败仍由 guard 拒绝、guard 缺失 fail-open、Registry 参数形状防御），
   已接入 `npm test` / `npm run gate`。
7. 版本 `0.1.30` → `0.1.31`。

### 验证

- `npm test`：`scan-secrets` 通过 + `sync-preset --check` 通过（23 个插件行）+ 8 个 guard 单测通过；
- `cordis.patch.yml` 内嵌 `preset-report-mode.plugins` 与镜像完全一致，含
  `restrict-host-team` / `guard-browser-local` 两行，mcp-browser args 含 6 条 `--allowedUrlPattern`；
- 手动验证（`@modelcontextprotocol/sdk` spawn `npx -y chrome-devtools-mcp@1.12.0` + 预设全部 args，
  未访问公网）：`initialize` OK（chrome_devtools 1.12.0）、`tools/list` 15 个工具；本地
  `http://127.0.0.1:<port>/` 页面与其 `fetch("/api")` 子资源正常；`http://preview.localhost:<port>/`
  （`*.localhost` 通配）正常；`http://127.0.0.2:<port>/`（不在白名单）被 allowlist 拦截并返回
  "blocked by blocklist/allowlist rules"；
- mock env 验证 `CPT_DB_CONNECTIONS` 生成 5 个连接名（Doris / 填报-读写 / MySQL / testdb /
  测试库，无「外接数据库」），`REPORT_DORIS_DATABASE` 生效；`REPORT_CPT_DB_CONNECTIONS`
  整串覆盖与空 env 行为不变。

## 0.1.30 — 当前树历史敏感值清理（不改变运行时行为）

- `CHANGELOG` 里 0.1.19 的测试库私网 IP 与只读账号改为"见 `.env`"描述，不再落明文。
- `config/report-mode.env.example` 的测试库用户名改为 `your_readonly_user` 占位符。
- `scripts/scan-secrets.mjs` 不再内置历史账号/口令片段/主机名明文：改为 **SHA-256
  哈希比对**（保留"历史值被改回来"的回归检测，命中只报告"值已隐藏"），并补通用
  "私有 IP / 内网域名"规则；`example.internal` 等保留示例域名放行。
- 说明：本次只清理**当前树**；历史 commit 的清理已在后续历史重写提交完成（旧 commit 对象
  已不在库内，`git log -S` 对历史敏感值 0 命中）。凭据仍建议按已泄漏处理（轮换）——重写历史
  不会让已经推送出去的口令重新变安全。

## 0.1.29 — 装配源同步 + 提示词修正 + Host 工具裁剪 + DB 连接注入

### 背景

0.1.28 之后的三次 persona 提交只改了
`presets/report-mode/agent.cordis.yml`，没有改真正被 DSH 挂载的
`cordis.patch.yml` 内嵌声明行；新 persona（事实源优先级、引用化、内置 SQLite
本地测试协议）从未进入运行中的报表模式。本版本把"改镜像但未同步装配源"做成
可自动拦截的问题，并修正与当前工具面不一致的提示词。

### 变更

1. **装配源同步机制**：新增 `scripts/sync-preset.mjs`，以
   `presets/report-mode/agent.cordis.yml` 为语义源，按声明行的 `plugins:` 缩进
   生成 `cordis.patch.yml` 对应段；`--check` 不一致时打印差异并 exit 1，已接入
   `npm test` 与 `npm run gate`。同时把当前镜像（含本地 SQL 协议/事实源优先级/
   去重段）同步进装配源。
2. **persona 修正**：
   - Office/Excel 段改为本模式实际拥有的 `mcp__excel__*` 四个只读工具
     （`excel_inspect` / `excel_profile_structure` / `excel_read_range_normalized` /
     `extract_images`），删除 `excel_create` / `excel_update` / `word_*` /
     `ppt_*` / `univer_*` 等不存在的正例，并注明本模式无 Office 写能力；
   - 团队协作改为"本模式不启用、不调用 `spawn_teammate` / `team_task_*`，
     只用 subagent + 共享清单"，与实际 bundle 状态一致；
   - `dataset_sql_parity` 标注属 `local_db` 租约族（先 `request_deep_tool_access`）；
   - 注释中的工具数改为 report 档 42 个静态工具，MCP 数量改为 7 个。
3. **Host 工具裁剪**：新增预设内 scoped 行 `restrict-host-toolbox`（仿
   `restrict-host-git`），deny 掉 profile 根级 `mcp-toolbox` 的
   `doris_query` / `report_query` / `test_query`；报表模式只保留自己的
   doris/mysql/testdb 三组 MCP，避免 15 个 DB 工具同场与"可见但被规则禁止"。
4. **cpt-mcp 真实库连接注入**：`mcp-cpt` 的 env 新增 `CPT_DB_CONNECTIONS`，
   由 `.env` 里的 `REPORT_DORIS_*` / `REPORT_MYSQL_*` / `REPORT_TESTDB_*` 自动
   生成（连接名覆盖 `Doris` / `外接数据库`、`填报-读写` / `MySQL`、
   `testdb` / `测试库`），可用 `REPORT_CPT_DB_CONNECTIONS` 整串覆盖；不落任何
   明文口令，`run_dataset_sql_check(target:"real")` / `dataset_sql_parity` 不再
   依赖第二份 `~/.cpt-mcp/db-connections.json`。
5. 版本 `0.1.28` → `0.1.29`。

### 验证

- `npm test`：密钥/可迁移性门禁通过 + `sync-preset --check` 通过；
- PyYAML 解析 `cordis.patch.yml`：`preset-report-mode.plugins` 与镜像源完全一致
  （21 个插件行），persona 含本地 SQL 协议、旧 Office/团队文本 0 残留；
- `CPT_DB_CONNECTIONS` 表达式经 mock env 验证生成 6 个连接名，override/空 env
  行为符合 cpt-mcp `lib/db.js` 的回落语义。

## 0.1.28 — 内置 `delete_file`（预设内 scoped 行，仅报表模式可见）

### 背景

报表模式 persona 从 0.1.4 起就写着「允许使用 … `delete_file`」并附完整删除流程，但当时
的恢复方式是把 `dsh-delete-file` 装成 **host 级 bundle**——工具对**所有**预设可见；后来该
外部包在 profile 里缺失，persona 与实际工具面长期不一致（报表会话里模型说"我来删"，
其实没有工具，只能让用户手动删）。

### 变更

1. 新增 `lib/delete-file.mjs`（导出子路径 `dsh-report-mode/delete-file`）：把原
   `dsh-delete-file` 的安全语义原样内置——仅会话工作区内、拒绝受保护路径段
   （`.git` / `node_modules` / `.reasonix` / `.agent-teams` / `.trash` / `.decompiled` /
   `.bak` / `.dsh` / `artifacts`）、默认移入同级 `.trash`（`use_trash:false` 才硬删）、
   目标不存在返回 `not_found`。
2. 预设 `plugins` 列表新增 scoped 行 `- id: delete-file / name: dsh-report-mode/delete-file`
   （装配源 `cordis.patch.yml` 与镜像 `presets/report-mode/agent.cordis.yml` 同步改）。
   scoped 注册只挂在报表模式的 agent scope 上，**其他预设看不到该工具**。
3. 与 `report-git` / `restrict-host-git` 同一机制（预设内 scoped 行）；不再需要 host 级
   `dsh-delete-file` bundle——已装的话应在 profile 停用/移除，避免同一工具双份注册且全局可见。
4. 顺带修掉 0.1.27 遗留的一处装配源/镜像不同步：`cordis.patch.yml` 的 persona 有
   「git_* 仅指伴随插件 dsh-report-git 提供的六个…」3 行，镜像 `agent.cordis.yml` 缺这 3 行
   （运行期以装配源为准，故无行为差异；本次两处已逐字对齐）。
5. 版本 `0.1.27` → `0.1.28`。

### 验证

- `node scripts/scan-secrets.mjs` 门禁通过；装配源与镜像两处 YAML 均可解析、插件行与
  既有 scoped 行（`report-git` / `restrict-host-git`）同构。
- 实现与已实测的独立包 `dsh-delete-file` 0.2.0 逐行一致，该实现的实测结论：
  `use_trash:true` → `trashed` 且同级 `.trash` 出现同名文件；`use_trash:false` → `deleted`
  且无备份；工作区外路径与 `.git` 受保护段均被拒绝并给出中文原因。
- 工具可见性：报表模式可见 `delete_file`，其他预设不可见（scoped 语义，0.1.27 起
  `report-git` 已用同一机制验证过）。

## 0.1.27 — 两套 git 工具按预设严格分工

### 目标

- **报表模式**：只用 `dsh-report-git` 的六个工具（含 push、建仓防呆、安全回退）。
- **其他预设**：只用 host 级 `dsh-plugin-git-workflow` 的五个工具（只读 + 提交）。
- 两边**互不可见**，避免两套 git 工具并存、职责重叠（例如 model 用 `git_commit` 绕过
  报表模式的 Gitee 推送策略）。

### 变更

1. **`dsh-report-git` 从 host 平面降到本预设**（scoped row `report-git`）。
   可行依据：该插件只 `inject: ["tools"]`，每次调用从 `exec.agent.session.header.cwd`
   取会话工作区，因此可以在预设内注册成 scoped 工具。
   **配套要求**：profile 里必须停用它的 bundle（`set_bundle dsh-report-git enabled:false`），
   否则它自带的 `cordis.patch.yml` 会在 host 平面再插一行 —— 同一插件双注册。

2. **新增 `lib/restrict-host-git.mjs`**（导出子路径 `dsh-report-mode/restrict-host-git`）：
   作为预设内 scoped 行调用官方 `ctx.tools.restrict({ deny })`，屏蔽 host 级
   `dsh-plugin-git-workflow` 的五个工具（`git_status` / `git_diff` / `git_log` /
   `git_commit` / `git_branch`）。

   机制约束（官方语义，见 `@deepseek-ai/dsh-tools`）：`restrict()` **只能**在 scoped
   context（`agent.ctx`，即预设内的行）调用，context-global 调用会直接抛错；它只 deny
   **global** 工具名，预设内 scoped 注册的工具不受影响 —— 正好是这里需要的效果。

   **fail-open**：host 工具不存在（如 `git-workflow` 未安装）时 `restrict()` 会抛错，
   本模块只告警、不阻断报表模式启动。

3. 版本 `0.1.26` → `0.1.27`。

### 装配源与镜像

`cordis.patch.yml`（`dsh.bundle.patch` 指向它，运行时真正装配的源）与
`presets/report-mode/agent.cordis.yml`（仓库内可读镜像）同步改。

顺带修掉一处自 0.1.23 起就存在的**两份副本失同步**：0.1.23 从装配源删掉了
`dsh-tool-git` 的 `tool-git` 行，但镜像里还留着，导致同一份预设有两套说法。
本次两处都换成新的分工注释与两行声明。

## 0.1.26 — 修致命缺陷：persona 里的 `{{cwd}}` 让报表模式整轮失败

### 现象

报表模式下**任何**一轮请求都直接失败：

```
unknown prompt variable "{{cwd}}" in section "deployment:persona-prefix";
registered variables: provider, model
```

因为 profile 设了 `agent-preset-registry.config.selectedDefault: report-mode`，
报表模式是**新会话的默认预设**，所以这不是"报表模式偶发故障"，而是新建会话一发就挂。

### 根因

`persona` 行的 `prefix` 里写了 `{{cwd}}`。DSH 的提示词插值是**严格模式**：
`@deepseek-ai/dsh-system-prompt` 的 `interpolate()` 对任何 `{{name}}` 先查
`Object.hasOwn(variables, name)`，查不到就 `throw`。而全局只注册了两个变量——
`@deepseek-ai/dsh-agent-loop` 的：

```js
ctx.systemPrompt.variable("provider", (context) => context.agent?.options.provider);
ctx.systemPrompt.variable("model",    (context) => context.agent?.options.model);
```

`{{cwd}}` **从来没有被注册过**。它从 0.1.0 首版就写在这里，一直没炸，是因为
旧内核的插值不校验未知变量（原样保留）；0.2.1-rc.2 起改为严格抛错，潜伏缺陷才暴露。
同仓的 `packages/dsh-coding-preset` 早已把这条写进注释：
「the working directory arrives as runtime context (the loop registers no `{{cwd}}` variable)」——
report-mode 是唯一漏改的预设。

### 修复

- `cordis.patch.yml`（**真正生效的装配源**：`dsh.bundle.patch` 指向它，预设由
  `preset-report-mode` 声明行随 bundle patch 下发）与
  `presets/report-mode/agent.cordis.yml` 两处同步改：
  `工作目录是 {{cwd}}` → `工作目录是你的会话工作区（见下方 runtime context 的 Current working directory）`。
  两处必须一致：前者是运行时装配源，后者是仓库内可读的镜像。
- 版本 0.1.25 → 0.1.26。

### 为什么删掉而不是改成别的写法

工作目录**已经**由官方 runtime context 自动注入，什么都不用写：
`@deepseek-ai/dsh-working-directory` 注册了 `working-directory:current` 段
（`required: true`），文本是

```js
contextText(session) { return `Current working directory: ${JSON.stringify(this.get(session))}.`; }
```

且该段显式 `interpolate: false`，本身不受严格插值影响。模型因此**始终**能看到当前工作目录，
persona 里再写一遍既冗余又会炸。

### 验收

- 全仓 `{{...}}` 扫描：仅剩 `{{model}}`（合法）；`{{cwd}}` 只出现在解释性注释里。
- 装配后不再抛 `unknown prompt variable`，报表模式一轮完整跑通。
- `npm test`（可迁移性 + 密钥门禁）通过。

## 0.1.25 — peer 依赖改成范围：内核升级后不必再等"重绑"

### 起因

0.1.24 把 `@deepseek-ai/dsh-tools` 的 peer **钉死在单个 rc 版本** `0.2.0-rc.2`。实测（2026-10-19
内核 0.2.0-rc.2 → 0.2.1-rc.2 升级）暴露两点：钉死的 rc 版本在内核一升级就"不满足"，插件是否还能
激活完全押在更新器的 **peer 重绑**上（安装副本被原地改写成新 rc）；重绑过的安装副本与源码仓库
**内容分叉**，下次从 git 重装会退回旧钉、重新触发同一问题。

### 变更

- `peerDependencies["@deepseek-ai/dsh-tools"]`：`0.2.0-rc.2` → `^0.2.0-rc.2`。
- 版本 0.1.24 → 0.1.25。**预设/门禁/文档零改动**，`npm test`（可迁移性+密钥门禁）通过。

### 依据（与 dsh-report-git 0.6.1 同源）

从内核 `app.asar` 取到的实际校验实现：`satisfies()` 用 `semver.satisfies(runtimeVersion, range,
{ includePrerelease: true })`，且只检查 `@deepseek-ai/dsh*` 开头的 peer（cordis 被忽略）。
裸 node-semver 因 prerelease tuple 规则让 `*` 都匹配不了 `0.2.1-rc.2`，但 DSH 语义下
`^0.2.0-rc.2` 可以。实测矩阵（`includePrerelease: true`）：

| 内核版本 | `0.2.0-rc.2`（原钉死） | `^0.2.0-rc.2` |
| --- | --- | --- |
| 0.2.0-rc.2 | ✓ | ✓ |
| 0.2.1-rc.1 / 0.2.1-rc.2 | ✗ | ✓ |
| 0.2.2 / 0.2.9（正式版） | ✗ | ✓ |
| 0.2.9-rc.1 | ✗ | ✓ |
| 0.3.0-rc.1 / 0.3.0 | ✗ | ✗（0.x 里 minor 即破坏性变更，**刻意不声称兼容**） |

覆盖 0.2.x 全线、不越界到 0.3。当前已安装的 0.1.24 副本不受影响；下次从 git 重装自动带上。

## 0.1.24 — 可迁移：去本机绝对路径，git 工具改用相对路径口径

### 起因（用户 2026-10-17 指令）

「同步更新，同样避免使用绝对路径，按照官方规范注册为插件使用相对路径。」上一轮
`dsh-report-git` 已改成 0.6.0（按会话工作区解析相对 `path`、去掉机器绑定路径）；本包作为
它的配套（预设 + 体检 + 安装文档）仍是老口径：预设让模型传**绝对路径**，mcp-excel 写死了
某个用户目录下的 `python.exe`，安装文档与 README 里还有带用户名的路径示例。换机器就会断。

### 变更

- **预设的 git 工具口径改成相对路径**（`presets/report-mode/agent.cordis.yml` 与
  `cordis.patch.yml` 两份同步）：所有示例从 `"path": "工作区目录或文件绝对路径"` 改为
  `"path": "."`，并在推送策略里写明「path 用相对会话工作区的相对路径，缺省 `.` 即工作区根；
  不要写绝对路径」。与 `dsh-report-git` 0.6.0 的解析基准（`exec.agent.session.header.cwd`，
  官方 `@deepseek-ai/dsh-tool-fs` 的 `sessionCwd()` 同源）一致。
- **mcp-excel 不再写死 python.exe**：`command:` 从"某个用户目录下的 python.exe 绝对路径"
  改为 `!!js process.env.REPORT_EXCEL_MCP_PYTHON ?? 'python'`——缺省走 PATH，要钉解释器就写
  环境变量（模板 `config/report-mode.env.example` 已登记该变量）。
- **发布前门禁扩成"密钥 + 可迁移性"**（`scripts/scan-secrets.mjs`）：新增两条通用规则——
  盘符绝对路径、固定 `Program Files` 下的 Git 安装位置；占位符（`<DSH_HOME>`、`<盘符>`、
  `<tgz 路径>`）与环境变量写法不算命中。`package.json` 增加 `npm test` / `npm run gate`。
- **清掉全仓库的本机痕迹**：`.gitignore` 里带用户名的临时文件模式改为通用
  `*report-git-cred*`；`README.md` / `docs/INSTALL.md` / `config/report-mode.env.example` /
  `install/install.ps1` / `packages/dsh-coding-preset/README.md` / `tools/apply-patch.mjs`
  里的"带用户名的绝对路径示例"全部改为占位符或环境变量。
- **安装口径按官方插件规范**：推荐 `dsh plugin --profile <profile> add
  git+https://gitee.com/sifu-ye/dsh-report-mode.git`（伴随插件同样从 git 源装），不再给
  "指向某个用户目录里的 tgz" 的写法；写死用户目录的安装命令会随机器失效。
- **文档与现状同步**：git 工具从"四个/三个"更新为**六个**（补上 `git_fetch` / `git_pull`），
  MCP 服务器从 5 个更新为 **7 个**（补上 `testdb` / `excel`）；README 与 INSTALL 明确
  **团队模式已下线（0.1.23 起）**，AgentTeams 安装 + 打补丁降级为"要恢复团队模式时才做"的
  可选项，避免新装用户照旧文档白装一遍。
- `package.json` 版本 0.1.23 → 0.1.24。

### 影响面

预设行为不变（工具名、策略、gate 全部照旧），变的只是"路径从哪来"与"文档怎么写"：
`path` 传相对值即可（绝对路径仍兼容），与环境有关的值（python 解释器、凭据文件、插件来源）
一律走环境变量/配置/官方 git 源。发布前跑 `npm test` 即可确认仓库没有机器绑定。

## 0.1.23 — git 工具归口 dsh-report-git：撤销 scoped tool-git 注册（消除重复注册）

### 起因（用户 2026-10-17 指令）

「将所有 Gitee 仓库管理相关的工具归类给 dsh-report-git，同时从 report-mode 中删除对应的工具，
确保不重复注册。」0.1.22 引入的 scoped tool-git 与伴随插件 dsh-report-git 存在实质重复：

- **同名冲突**：dsh-tool-git 的 `git_fetch` / `git_pull` 与 dsh-report-git 的同名工具；
  且 dsh-tool-git 自带 `cordis.patch.yml` 还会往 **host 平面**插行，两边同时生效即双注册。
- **职责重叠**：`git_status` vs `git_repo_status`、`git_commit` vs `git_commit_all`、
  `git_remote` vs `git_link_remote`——Gitee 建仓/关联/推送/回退/同步本应只有一份实现
  （0.1.13 删掉自带 `git-tools.js` 副本时已定过同一原则）。
- **现实缺口**：报表现场真正缺的是 `dsh-report-git` 装上没有（0.1.22 起只有 `checkGitTools()`
  体检告警），而不是再挂一套通用 git 族。

### 变更

- **删除 preset 里的 `tool-git` 行**（原 `cordis.patch.yml` 中「git 工具（dsh-tool-git 0.1.x，
  仅本预设可见）」整段），改为一段说明为什么刻意不注册。报表模式的 git 能力＝
  `dsh-report-git` 的六个（`git_commit_all` / `git_repo_status` / `git_rollback` /
  `git_link_remote` / `git_fetch` / `git_pull`），唯一实现、唯一提供者。
- **persona 允许清单收紧**：`git_*` 明确限定为上述六个，并写明"不存在 dsh-tool-git 那套
  git_status/git_commit/git_remote"，避免模型去找不存在的工具名。
- 通用 git 族（diff/log/stage/branch/checkout/stash/show）如需使用，改为 **profile 层决定**
  是否启用 `dsh-tool-git` bundle——本预设不再声明它，因此不再有"预设 + host"双注册。
- `package.json` 版本 0.1.22 → 0.1.23。

### 注意（需要 profile 侧配合）

预设不再注册 `dsh-tool-git`，不等于它消失了：该 bundle 若仍是 `enabled:true`，其自带 patch
会把 12 个工具插到 **host 平面**（对所有预设可见），届时 `git_fetch` / `git_pull` 与
`dsh-report-git` 仍会同名。要彻底"不重复注册"，二选一：

1. profile 里停用该 bundle：`plugin_manager set_bundle dsh-tool-git enabled:false`（推荐，
   git 能力全部归口 dsh-report-git）；或
2. 若保留该 bundle（通用 git 族全局可用），则从 dsh-report-git 移除 `git_fetch` / `git_pull`，
   让同步类操作只由通用族提供、Gitee 专属四个留在 dsh-report-git。

## 0.1.22 — 团队模式下线 + 新增只读能力：去 agent-teams，mcp-excel / scoped tool-git

### 变更

1. **团队模式下线**：删 bundle 补丁里的 `agent-teams` 行与提示词里的团队章节
   （命令-only 开团、队长汇总、记忆授权）；同类协作改走「子代理委派 + 共享清单」；
   `/agent-teams` 输入明确告知不支持，不再假装开团。`package.json`
   描述与 keywords 同步去掉 agent-teams。
2. **新增 `mcp-excel`**（`@deepseek-ai/dsh-mcp-client`，`serverName: excel`）：
   轻量 xlsx/xlsm/xls/xlsb/ods 只读（`excel_tools.server`），读导入模板/填报底表；
   cpt-mcp 只管 `.cpt`，通用 xlsx 由它负责。
3. **新增 scoped `tool-git`**（`dsh-tool-git`，`destructivePolicy: deny`，仅本预设可见；
   破坏性操作一律拒绝，推送仍只走 `git_commit_all`）。配套：profile 里把 host 层
   `dsh-tool-git` bundle 停用（包保留供本行解析），避免重复注册。
4. 版本号 0.1.20 → 0.1.22（0.1.21 的 peer 对齐保留：`@deepseek-ai/dsh-tools 0.2.0-rc.2`）。

## 0.1.21 — peer 对齐 DSH 0.2.0-rc.2：`@deepseek-ai/dsh-tools` 0.1.2-rc.1 → 0.2.0-rc.2

0.1.20 在 0.2.0-rc.2 运行时上报 `incompatible-version`（`rows` 为空，报表模式预设加载不上）。
只改 peer 声明，不碰功能与补丁链路。

### 变更

1. `package.json`：`peerDependencies["@deepseek-ai/dsh-tools"]` 由 `0.1.2-rc.1` 提至
   `0.2.0-rc.2`；版本号 0.1.20 → 0.1.21。

## 0.1.20 — DSH 0.2.0 兼容：预设改声明行 + 两处打包/加载硬伤修复

三个 bug 在 DSH 0.2.0-rc.2 上是**致命**的（预设看不到、Web 启动直接崩），逐条修复：

### 变更

1. **预设改用 `@deepseek-ai/dsh-agent-preset` 声明行**（`cordis.patch.yml` 新增
   `preset-report-mode` 行，`plugins` 由 `presets/report-mode/agent.cordis.yml` 原样迁移，
   `name`/`description` 取自 `preset.yml`，`order: 10`）。
   根因：DSH 0.2.0 起**不再读** `$DSH_HOME/.agent-presets/<id>/` 目录式预设——官方 SKILL
   `editing-cordis-compositions` 原话 "Nothing reads that directory any more"。
   原先 `lib/bootstrap.js` 把预设落进那个目录的整套逻辑在 0.2.0 上是空转，故默认
   `presetAutoInstall: true` → **`false`**。
2. **`client/index.js` 改写为 `__ModuleLoader__` 自注册 bundle**。
   根因：DSH 的 `dsh-client-modules` 读取 `exports["./client"]` 后把文件**原始字节**拼进一个
   经典 `<script>`（`buildComboScript` → `prepareSource`，只剥 source-map 尾巴，不转译）。
   原来的裸 ESM（顶层 `export`）会让整段 combo `SyntaxError: Unexpected token 'export'`，
   **连累同组另外 10 个插件一起不激活**，最终 `web boot: 1 entry did not activate` 让
   Web 启动失败。顶层 `const STYLE_ID` / `function apply` 还会落到全局作用域撞名，
   现在一并收进 `factory()` 闭包。
3. **`package.json` 的 `files` 补上 `cordis.patch.yml`**。
   根因：`dsh.bundle.patch` 指向 `./cordis.patch.yml`，但 `files` 白名单漏了它 →
   `npm pack` 打出来的包里没有这个文件，任何安装方式（git / tgz / `file:`）都会在校验
   overlay 时报 `ENOENT` 并回滚。
4. **新增伴随包 `packages/dsh-coding-preset`**：把个人的旧目录式用户预设
   `.agent-presets/coding/`（「编码（Git Bash）」）一并迁成 `preset-coding` 声明行
   （同一个根因——0.2.0 不读那个目录）。迁移时改了 1 处必改的插件名：
   `@deepseek-ai/dsh-workflow-worker-thread` → `@deepseek-ai/dsh-workflow-ptc`
   （旧名在 0.2.0 上解析不到，会在激活时失败），其余 26 个插件名逐一核对未变。
   该包**独立安装**、不进 `dsh-report-mode` 的 tarball（`files` 不含 `packages/`），
   详见 `packages/dsh-coding-preset/README.md`。

### 生效条件

**需重启 DSH**（或至少刷新页面重跑 web boot）。重启后预设选择器里出现「报表模式」，
`list_plugins` 里 `include:preset-report-mode` 行应为 `fiberPhase: active`。

### 校验

- YAML 解析 ✓；新 patch 3 个顶层元素，原有 2 个逐字保留 ✓
- 迁移后的 `plugins` 与 `presets/report-mode/agent.cordis.yml` **JSON 结构完全相等**
  （16 条顶层插件，含嵌套共 19 条）✓
- 19 个插件条目的 `name` 全部在 0.2.0-rc.2 上解析成功 ✓
- `client/index.js` 按经典 script 解析 ✓；顶层 `export`/`import` 零残留 ✓
- 全量 combo 预检（72 个 client bundle 拼成 12 MB 单脚本）解析通过、顶层标识符零冲突 ✓
- `include:preset-report-mode` → `fiberPhase: active` ✓

## 0.1.19 — 新增测试库连接（mcp-testdb，只读）

### 变更

- 预设新增第 6 个 MCP 行 `mcp-testdb`（`serverName: testdb` → 工具名形如 `mcp__testdb__*`）：
  测试环境数据库-主节点（地址与只读账号见 `.env`，仓库不落明文）。
  与 doris / mysql 同一驱动（`mysql-mcp-server`，npx），连接信息全部走 `.env` 的
  `REPORT_TESTDB_HOST/PORT/USER/PASSWORD`（不设 MYSQL_DATABASE，连服务器默认库）。
- persona：文件头"构成"改为六个 MCP 服务器；服务器清单加第 5 项
  （注明只读账号——只做 SELECT / SHOW / EXPLAIN，不做写入）；SQL 优化流程 b 步
  （查库上下文）加 `mcp__testdb__*`。
- `config/report-mode.env.example` 补 `REPORT_TESTDB_*` 模板段。

### 生效条件

`.env` 由宿主进程启动时加载，MCP 行在会话启动时拉起 → **需重启 DSH**，
之后新开的报表会话即可使用 `mcp__testdb__execute_query` / `describe_table` / `list_databases`。

### 校验

YAML 解析 ✓、16 行 ✓、线上 == 插件源 ✓、4 个 env 引用全部指向 `REPORT_TESTDB_*` ✓、
persona 三处提及齐全 ✓；`.env` 四键已就位 ✓。

## 0.1.18 — .cpt 读取协议补漏：堵住"分页窗口读"这条最大浪费通道

### 起因（实测：规则有效性三层核验，近 14 天 126 个报表会话全量日志）

- ✅ **硬规则 100% 生效**：`read` 全文读 .cpt = **0 次**（529 次触碰全部带 limit/offset）——
  "绝不用 read 全文"（单次即 10 万 token 的坑）真的堵住了；`read_cpt` 实测平均 **482 字符**，
  persona 的"仅概览"描述与工具实相相符；结构化读取 333 次被实际使用。
- ⚠️ **漏洞**：persona 规则只禁"全文"、只说"一律走 cpt-mcp"，**没规定"没有对应视图时怎么办"**
  → 模型钻空子用 `read(limit/offset)` 一页页啃 XML：**529 次 / 1,971,524 字符 / 均 3,727 字符每页**
  = 54% 的 .cpt 内容消费走这条通道，比全部结构化工具加起来还多，每次还各带一个模型往返。
- ⚠️ `get_cells` / `get_datasets` 实测平均 **7,132 / 7,716 字符**——规则 4 要求"细过滤"，
  但均值仍 7k，说明常不带过滤整片拉取。

### 变更（token 协议新增第 5、6 条，同段落）

- **第 5 条**：定位 XML 片段先 `grep`（行号+锚点）文本定位，不要 read 分页啃原始 XML
  （附实测数据说明为什么）；确需原始窗口时先查 cpt-mcp 对应视图
  （get_report_listener / get_cell_listener / get_webwrite_js / get_cell_dictionary），
  确实没有才用 read，且**单次 ≤ 60 行、看完即弃**。
- **第 6 条**：`get_cells`/`get_datasets` 单次返回 **> ~3000 字符即视为"没带过滤"**，
  带 sheet/行列/名称参数重试分次取（附实测均值 7132/7716 的"整片拉取"痕迹说明）。

### 配套验收（cpt-mcp-context-plan/audit-cpt-read.mjs）

固化本次核验为可复跑 gate：全文读必须 0、`read_cpt` 均值 ≤1000 字符（硬），
窗口读 ≤2 次/会话、get_cells/get_datasets 均值 ≤3000 字符（行为指标，待新会话验证生效）；
`--since=YYYY-MM-DD` 可只评估该日期之后新建的会话，用于隔离本次改动的效果。

## 0.1.17 — 补回子代理复用/打断通道（复用缺口修复）

### 起因（两个实测问题）

1. **复用断链**：persona「子代理复用与共享清单」第 2 条要求用 `send_message` 续聊同一子代理，
   但 0.1.15 加过的 control 行在一次回退提交里被**连带撤掉** → 指令有、工具没有。
   实测 **469 个报表会话：subagent 新建 118 次、复用 0 次**（结构上不可能复用）。
2. **无法应对"用户改已提交的信息"**：报表模式 100 个工具里子代理只有 `subagent`——
   无 `list_agents`（找不到在跑的）、无 `interrupt_agent`（叫不停）、无 `send_message`（改不了向）；
   DSH 侧也没有"用户改消息→自动停子代理"的兜底（源码未见该机制），
   旧子代理会拿着旧信息跑完。用户场景：提交后又修改条件 → 只能干等或丢弃重来。

### 变更

- 预设补两行（与内置 `standard` 第 175-179 行同名同包）：
  `tool-subagent-control`（`send_message` + `interrupt_agent`）、`tool-subagent-list-agents`。
  纯消费型行（inject = tools/subagents/agents，宿主注册表；包内无 provide），无需 isolate。
- persona 新增**第 6 条**：用户修改已提交信息且子代理在跑时 → `list_agents` 定位 →
  `interrupt_agent` 硬停（上下文保留）→ `send_message` 发修改后续作；
  【禁止】旧子代理带旧信息跑完、【禁止】未停旧代理就另派新的（会并行跑出两套矛盾结果）。
- 工具白名单加「子代理控制：subagent / list_agents / send_message / interrupt_agent」
  （避免"指令有、授权没有"的同类错配）。
- 成本：三工具实测 717 harness ≈ **1,040 真实 tokens/请求**（send_message 193 + interrupt 182 + list_agents 342）。

### 本次验证说明（诚实记录）

- 结构校验全绿：YAML 解析 ✓、15 行 ✓、线上 == 插件源 ✓、persona 第 6 条与白名单 ✓。
- **未能跑 `standingKeyFor`**：当前部署的 `cordis_define` 对 `plugin` 参数报
  `must match exactly one oneOf branch (matched 0)`（schema 符合仍失败；换子代理发话同样失败 →
  运行态侧异常，非本次改动引入）。改为证据链替代：包存在且 exports 匹配 ✓、行名与内置
  standard 逐字一致 ✓、inject 全为宿主注册表且 report-mode 现有 `tool-subagent` 行已在实况
  消费 `subagents`（118 次真实 spawn 成功）✓、包内无 `provide(` ✓。
- **最终验收**：新开一个报表模式会话，确认工具表出现 `send_message`/`interrupt_agent`/`list_agents`。

## 0.1.16 — 自己同步远端 + 工具面瘦身

> 版本号跳过 0.1.14 / 0.1.15：那两个号当天曾用于"子代理固定 muse1.3 / 委派优先"，随后按用户要求
> 整体回退（见当时的回退提交），为免同号不同内容，这里直接取 0.1.16。

### 变更

- **同步能力（配套 dsh-report-git 0.4.0）**：工具白名单加入 `git_fetch` / `git_pull`；
  "Gitee 拉取同步"规则由**"报表模式没有 pull 工具，请用户去有 shell 的会话手工 pull"**改为：
  先 `git_fetch` 拿最新 ahead/behind → 未分叉就 `git_pull`（默认 `--ff-only`）→ **分叉或脏树被拒时
  停下问用户，不得自己造 merge 提交、更不得假装已同步**；并明确 `sync.ahead/behind` 是"基于上次 fetch"的值。
  起因：sandbox7 会话实测工具面只有 commit/push/status/rollback/link，遇到远端领先时只能求助 shell 会话。
- **browser MCP 分类裁剪**：`chrome-devtools-mcp` 增加 5 个 `--no-category*` 参数，
  工具数 **30 → 13**（保留 console 读取 / 截图 / evaluate / navigate），实测省 **3,936 tokens**（provider 口径）。
- **`ppt_*` 全局停用**：persona 删掉 `ppt_*` 允许项与 `ppt_create/ppt_read` 列举，改为明确
  "已全局停用、不要调用也不要找替代路径"（配置侧在 profile 补丁 `enablePptTools: false`）。
  只改配置不改 persona 会留下"点名了不存在的工具"的矛盾——与 bash 那次同类问题。

### 本机 profile 侧（不在本包内，一并记录）

- profile 补丁删掉 `- id: tool-bash, disabled: false`：报表模式不再带 shell（内置预设自带该行且
  Windows 上本就 disabled，故零副作用）；`bash-sandbox` 保留。
- 新增 `- id: dsh-office-tools` + `enablePptTools: false`。
- profile 补丁新增 opencode 请求头覆盖（8 条路由），修复 `400 MissingSessionID`。

## 0.1.13 — 统一真源：git 工具只留一份实现

### 变更

- **删除 `lib/git-tools.js` 与 `test/remote-policy.test.mjs`**。git 工具（`git_commit_all` /
  `git_repo_status` / `git_rollback` / `git_link_remote`）的唯一实现改为独立插件
  **`dsh-report-git`**；两份并存时工具名会冲突，而且"谁提供工具"直接决定报表模式有没有
  0.1.12 新加的"自助关联既有远端"通道（副本里没有 `git_link_remote`）。
- 本插件退回它真正独有的两件事：随包预设自举 + 两项体检；不再注册工具，也不再 `inject` tools 服务。
- 新增 `checkGitTools()` 与 `locateInProfiles()`：启动时体检伴随插件是否装上，缺失就告警并
  给出可直接粘贴的安装命令——不让"少了一整组工具"这件事静默发生。
  `locateAgentTeams()` 原有的 profile 探测逻辑抽成 `locateInProfiles()` 复用，行为不变。
- `cordis.patch.yml`：删掉 `gitTools:` 配置块（它配置的是那份被删掉的实现），新增
  `gitToolsCheck`；`README` / `docs/INSTALL.md` 补上"同时安装 dsh-report-git"这一步与验收项。
- 凭据三级回退（`GITEE_CREDENTIALS_FILE` → `$DSH_HOME/gitee-credentials` → reasonix 旧路径）
  随实现一起并入 `dsh-report-git` 0.3.1，能力没有丢。

### 有意放弃的两个配置开关（原副本独有，本机从未使用）

- `gitTools.autoCreateRemote`：恢复"按文件夹名自动建仓"。这正是脏仓库的来源，不再提供开关。
- `gitTools.deniedRepoNamePattern`：追加禁用名单。内置名单够用，需要时改代码而不是加配置。

## 0.1.12 — 远端已存在的仓库：报表模式自己关联，不再求 shell

### 变更

- 配套 `dsh-report-git` 0.3.0 的 `git_link_remote`，预设新增第 3 条放行路径（三选一里的 c）：
  目录名被建仓防呆拦下（`sandbox*` 等）、或用户说"仓库我已经在 Gitee 网页建好了"时，
  先 `git_link_remote({ path, repo })` 关联 origin（**只关联、绝不新建**），再 `git_commit_all` 推送；
  只有远端确实还没有该仓库时，才请用户去网页新建。同时在推送策略里明确：
  **不要因为"我没有 shell、加不上 origin"就把用户挡回去**。
- 纠正"防呆门不可绕过"的说法：这道门**只拦【新建】**，不拦关联已存在的仓库；
  原文写成"会被直接拒绝——不要试图绕过"，会让模型把可解的问题当成死路。
- 工具白名单与"Git 统一落库"小标题补上 `git_link_remote`。

### 起因

`sandbox9` 会话连续三轮 `pushed:false`（t9/t12/t13），把建仓防呆门误判为死路，
最后让用户去"有 shell 的会话"手工 `git remote add` —— 而远端的 `sifu-ye/sandbox9`
其实早就建好了（2026-09-22 09:48），报表模式缺的只是一条"关联既有远端"的工具通道。

## 0.1.11 — 表 COMMENT 必须可反查到 FDL

### 变更

- SQL 协议新增第 5 条：建表语句的表 COMMENT 写成
  `'展示别名(建表人-数据对象)'` 格式（如 `'微生物汇总展示表(<owner>-微生物汇总表)'`）；
  展示别名是表的中文名，建表人是发起人标识，数据对象是该表供数的下游
  （报表名/FDL 节点名），以便从需求反查到 FDL 定时任务。三项不确定的逐项问用户。
  与 0.1.10 的文件头归属配合：文件头记"给谁建"，表 COMMENT 记"谁建的、供谁用"。

## 0.1.10 — DDL 必须自带报表归属

## 0.1.10 — DDL 必须自带报表归属

### 变更

- SQL 协议新增第 4 条：每个 CREATE TABLE 文件头用 `--` 注释写明目标报表
  （报表名/.cpt 名）、来源表（含 MySQL 源表名/口径）、创建日期；无报表归属
  的不建，有疑问先问。DDL 文件与表同名落盘到同类 DDL 目录（如 `ods_ddl/`），
  改表时同步更新头注记。起因：`ods_bas_product_register_head` 这类表的事后
  溯源（谁建的、给哪个报表）全靠翻会话，归属应在生成时同步写入。

## 0.1.9 — 新增通用规则：实测优先于推理

## 0.1.9 — 新增通用规则：实测优先于推理

### 变更

- 白名单段新增"实测优先于推理（必须遵守）"：凡涉及环境、工具、连接、
  数据能力的结论，一律以工具返回或文档原文为准；跨连接、跨库的能力外推
  （如"SELECT 能跑则 DELETE 能跑"）必须实测验证；结论中分清"实测"与"推理"，
  推理不得作为交付依据。起因：既有防猜规则全是窄的（console 先行、官方口径
  查文档、cpt 过门禁），拦不住跨连接外推这类推理；fr_ds_sql 资产实例核验：
  Doris 只在展示/读取侧，写路径全是 MySQL，DELETE 零先例。

## 0.1.8 — 文件引用链接化：裸文件名渲染蓝色超链接

## 0.1.8 — 文件引用链接化：裸文件名渲染蓝色超链接

### 变更

- 新增规则：提到本会话经手（读/写/改）的文件时，只写裸文件名并用反引号
  包裹（如 `sync_all_union.sql`），不要带目录——GUI 会渲染成蓝色超链接，
  点击进侧边栏预览。实测结论：裸名＋经手过＝蓝；带目录/markdown 链接/
  file://、未碰过的文件＝不蓝（sandbox7 v4 会话现象＋本会话对照复现）。

## 0.1.7 — 预设默认关闭跨会话记忆

## 0.1.7 — 预设默认关闭跨会话记忆

### 变更

- 白名单下新增：不调用 `memory` / `memory_recall` / `memory_search` /
  `memory_stats`，不读写任何跨会话记忆；只有用户明确要求时才用。
  原因：记忆是组合层的全局能力，预设没有硬黑名单机制，本规则只约束
  报表模式会话。已有记忆数据不动；如需全局硬关，见下。
- 备选（未实施）：profile patch 加 `- id: memento / disabled: true`
  可从所有会话摘掉记忆工具；dsh-memento 无他包硬依赖，关了不连带坏东西。

## 0.1.6 — 预设补一条建团规矩：task 必须挂 assignee

## 0.1.6 — 预设补一条建团规矩：task 必须挂 assignee

### 变更

- 团队章节新增第 5 条：每个 task 都要指定 assignee（分析师 / 取数员 /
  实现员 / 审查员四选一，不能空、不能填队长），否则建团校验直接拒绝
  （`profile task "t1" is missing an assignee`）。起因：上游 0.1.20 要求
  所有计划任务有主，旧 fork 习惯（空着等认领）已失效，而预设从没写过
  这条，导致用户与队长模型重复撞墙。
- `report` 线上默认预设已删（见 `.agent-presets-backup`），本次只同步
  `report-mode`。

## 0.1.5 — persona 键名修正（`text:` → `prefix:`，否则新会话建不起来）

### 变更

- `@deepseek-ai/dsh-persona` 的配置键是 `prefix:`（官方预设与 wowyuarm
  预设皆如此），本预设长期误写成 `text:`，导致 preset-tree 报
  `$.prefix missing required value`、新会话挂载失败。这是加号点不动的
  直接原因之一（另一原因是 agent-teams 0.1.20 与 Harness 0.1.5-rc.2
  不兼容，见本机 profile 处理）。块样式 `>-` 未动，渲染不变。
- `report` 线上默认预设同步了同样的修正。

## 0.1.4 — 恢复 delete_file（dsh-delete-file 0.1.0 重装）

### 变更

- 预设删除段改回 `delete_file`（默认进同级 `.trash`，可恢复；工作区外与
  保护路径拒绝），白名单加回 `delete_file`。`report` 线上默认预设同步。

## 0.1.3 — 预设与插件配置对齐“无 univer / 无 fork 补丁”现状

### 变更

- 预设（`presets/report-mode/agent.cordis.yml`）不再引用已卸载的能力：
  `univer_*` / `mcp__univer__univer_worktree` / `delete_file` / `read_file` /
  `write_file` / `edit_file` / `agent_teams_memory_*` 全部改写或删除。
  Excel/Office 主路径改为 `dsh-office-tools`（`excel_create/read/update`、
  `word_*`、`ppt_*`）；文件读写改为内置 `read` / `write` / `edit`；
  删除改为"列出候选由用户动手"（当前无删除工具）；`.univer` 不再作为交付物。
- `cordis.patch.yml` 的成员执行规范不再要求 memory 工具；`patches/` 的 report
  补丁改为可选项（0.1.3 起默认不再要求）。
- `lib/bootstrap.js` 的 AgentTeams 体检不再把"没打补丁"当告警：
  只确认装了基准版 0.1.20；memory 模块是否存在仅记录、不告警。
- `report` 线上默认预设同步了同样的改写（另把旧版"按文件夹名自动建仓"
  的描述升级为 0.1.2 的默认不建仓策略）。

## 0.1.2 — git 工具默认不再按文件夹名自动建 Gitee 仓库

### 变更（破坏性，但这是刻意的）

- `git_commit_all` 的远端策略改为：**有 origin 就直接推送；没有 origin 时默认不建仓**，
  只做本地提交，并在返回的 note 里说明原因。旧行为是按文件夹名自动建仓，于是任何临时/沙盒
  目录只要调过一次 `git_commit_all`，Gitee 上就会多出一个同名私有仓库
  （`sandbox8`、`sandbox10`、`V3`、`fdl_sync` … 一批脏仓库的来源）。
  建仓是对外、可发现、难以撤销的动作，不该被"顺手落库"触发。
  要发布到 Gitee，现在必须走三条受控路径之一：
  1. 调用参数 `createRemote: true`（可用 `repoName` 显式指定名字）；
  2. 目录内放 `.gitee-repo` 声明文件（内容为仓库名，留空则用文件夹名）；
  3. 配置 `gitTools.autoCreateRemote: true`（恢复旧的全自动行为）。
- 新增防呆名字门：无论走哪条路径，`sandbox*` / `tmp` / `temp` / `test*` / `scratch*` /
  `untitled` / `workspace` / `新建文件夹` 一律拒绝建仓；`gitTools.deniedRepoNamePattern`
  可再追加规则。
- `git_repo_status` 新增 `declaredRepo` 与 `remotePolicy`，直接说明该目录当前会不会建仓。
- 预设 persona 同步更新：明确"落库不等于建仓"，并禁止为了让推送成功而自行加 `createRemote`。

### 验证

- 新增 9 个场景的**离线**回归测试（fetch 打桩 + 全局 `pushInsteadOf` 把推送重定向到本地裸库，
  全程不触网、不建任何真实仓库）：默认不建仓且**零网络请求**、显式建仓并按目录名、按声明名建仓、
  `sandbox8`/`sandbox10` 即使显式要求也被拒、`push:false` 既不推也不建、已有 origin 照常推送、
  配置恢复旧行为等，全部通过。

## 0.1.1 — 修正两处「看起来能跑」的隐患

### 修复

- **`CPT_MCP_ALLOWED_ROOTS` 的兜底不再退化成空串**。原表达式是
  `… ?? process.env.DSH_CWD ?? ''`，但 DSH **不把 `DSH_CWD` 导出到自己的进程**
  （实测为空），所以只要别处没有设置这个变量，cpt-mcp 就会拿到空白名单并拒绝所有
  `.cpt` 路径。现在兜底顺序为：显式值 → `DSH_CWD` → 用户主目录。
  本机此前"能用"只是因为用户级环境变量里 `setx` 过 `CPT_MCP_ALLOWED_ROOTS`——
  这是一条隐式依赖，换台机器就会踩空。
- 修正预设里两处与实现不符的注释（关于 `DSH_CWD` 回退的说明）。

### 变更

- `.env` 模板与文档新增说明：**含 `#` 的值必须加引号**。DSH 用 `node:util` 的
  `parseEnv` 解析 `.env`，未加引号时 `#` 会被当作注释起点——实测
  `PASSWORD=pass!@#` 会被解析成 `pass!@`，表现为静默的认证失败。
  另外 Windows 路径写成 `KEY="<盘符>:\path"` 这种单反斜杠形式即可，**不要**写成双反斜杠
  （反斜杠会被原样保留，解析出来就不是你要的路径）。

## 0.1.0 — 首个版本

**背景**：报表模式此前是一份手写预设（`~/.dsh/.agent-presets/report/`）加一份改过的
AgentTeams fork。本版本把它整理成可安装、可升级的插件，并去掉仓库里的明文凭据。

### 新增

- **host 级 git 工具**（对所有预设可见）：`git_commit_all`（自动 init + 按文件夹名建
  Gitee 私有仓 + 推送）、`git_repo_status`、`git_rollback`（安全回退，脏工作区先自动提交
  回退安全点）。
- **随包预设 `report-mode`**（显示名「报表模式」）：5 个 MCP 服务器（cpt-mcp、
  fr-docx-mcp、doris、mysql、browser）+ 文件读写/搜索/提问/待办/子代理工具 + compaction 组，
  以及完整的报表工程师 persona。
- **预设自举安装**：插件启动时把随包预设落到 `<DSH_HOME>/.agent-presets/report-mode/`，
  带版本印记；只在目录缺失或带本插件印记时写入，绝不覆盖用户手写的预设。
- **AgentTeams 补丁链路**：依赖 npm 原版 `@nanmicoder/dsh-agent-teams@0.1.20`，报表适配
  以一个 4 文件补丁落地（命令-only、成员间消息通知队长、分域记忆三工具 + 存储层）。
- **补丁执行器** `tools/apply-patch.mjs`：自带 unified-diff 应用器（不依赖 `git apply`，
  规避 CRLF 与仓库上下文两个坑），支持 `check` / `apply` / `verify` / `revert` 与
  `--dry-run`，带版本锁与逐步 sha256 校验。
- **浏览器半区**：队长会话时显示深色背景与 `AgentTeams` 角标，从 fork 的 client 代码
  外移而来（只用公开接口，零补丁）。
- **发布前密钥门禁** `scripts/scan-secrets.mjs`：命中明文口令、内网主机名、Windows
  用户目录绝对路径即拒绝发布。

### 变更

- **凭据全部外置**到 `<DSH_HOME>/.env`：预设里不再有库口令、内网主机名、本机绝对路径、
  硬编码 `PATH`、reasonix 状态目录下的绝对入口路径；改为 `!!js process.env.*` 表达式。
- **Gitee 凭据查找**改为三级回退：`GITEE_CREDENTIALS_FILE` → `<DSH_HOME>/gitee-credentials`
  → reasonix 旧路径（此前只认最后一条）。
- **团队模板不写死模型**：`报表团队` profile 的成员不指定 provider/model/reasoning_effort，
  默认继承队长当前路由，也可在活动面板逐个调整。
- 成员/队长协作规则从改源码改为 `executionPrompt` 配置项下发（零补丁）。
- 修掉 persona 里两处历史上被改坏的段落（断句与串段的孤儿句）。

### 安全

- **Gitee 令牌不再落盘**。推送改用子进程环境变量注入认证头
  （`GIT_CONFIG_COUNT`/`KEY_0`/`VALUE_0`，git ≥ 2.31），既无临时凭据文件，也不进 argv；
  报错文本里的令牌会被抹成 `***`。`-u` 只针对 `origin`，避免把带令牌的 URL 写进
  `.git/config`。
  旧实现（沿用自 `dsh-report-git` 0.2.0）把 `https://<user>:<token>@example.invalid` 写进
  `join(tmpdir(), 'report-git-cred-...')`，但 DSH 的文件层会把绝对临时路径**压平到当前
  工作区**、且 `finally` 的删除同样失效，实测在本机 `Desktop\sandbox\` 下累积了数十份
  含明文令牌的文件——本次一并清理，并在 `.gitignore` 里加了兜底规则。
- 新增 `scripts/scan-secrets.mjs` 发布前门禁：明文口令赋值、内网主机名、Windows
  用户目录绝对路径、常见令牌形态，命中即拒绝发布。

### 已知限制

- 补丁作用于 `node_modules`：重装/升级 AgentTeams 后需重打；上游换版本时补丁工具会先拒绝，
  需按 `docs/PATCH.md` 重新生成。
- MCP 服务器（cpt-mcp / fr-docx-mcp / mysql-mcp-server / chrome-devtools-mcp）是外部依赖，
  不在本仓库内。

