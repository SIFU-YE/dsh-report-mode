# 安装与迁移

本文档面向「本机已经在跑一份报表模式 fork，想换成原版 + 补丁」的场景，也适用于全新安装。

全程分五步：**备份 → 装原版 → 装插件 → 打补丁 → 填凭据并验收**。
每一步都有可回退点，任何一步失败都可以退回原状。

> **0.1.23 起团队模式已下线**：预设不再注册 `@nanmicoder/dsh-agent-teams`。因此全新安装
> 只需要第 **3**、**5** 步；第 **1/2/4** 步（装原版 AgentTeams + 打补丁）只在你要**恢复
> 团队模式**时才需要，日常安装请跳过。

> 前提：命令都在**有 shell 的 DSH 会话（Git Bash）**里执行（报表模式预设刻意没有 shell）。
> `dsh` 与 `pnpm` 是垫片脚本，Git Bash 里可能不在 PATH 上；必要时用完整路径——先
> `where dsh`（PowerShell 用 `Get-Command dsh`）找到本机那份 `dsh.cmd` 即可。
> 本文档的命令示例统一写 `dsh`，请自行替换成完整路径或 PATH 名。

---

## 0. 先看清楚现状

```bash
# 当前 profile 装的是什么版本的 agent-teams
node -e "console.log(require('${DSH_HOME:-$HOME/.dsh}/profiles/desktop/node_modules/@nanmicoder/dsh-agent-teams/package.json').version)"

# 本插件对当前环境的体检结论（会打印人话结论）
node tools/apply-patch.mjs --mode check --profile desktop
```

三种可能的结论：

| 结论 | 含义 | 下一步 |
| --- | --- | --- |
| `原版未打补丁（0.1.20）` | 已装基准版，可打补丁 | 跳到第 3 步 |
| `不是补丁基准 x.y.z（看起来是本地 fork 版本）` | 还在用 fork | 走第 1、2 步 |
| `未安装 @nanmicoder/dsh-agent-teams` | 没装 | 走第 2 步 |

---

## 1. 备份（可跳过，但不建议）

记录当前状态，便于任何一步出问题时回退：

```bash
prof="${DSH_HOME:-$HOME/.dsh}/profiles/desktop"
cp -f "$prof/package.json" "$prof/package.json.bak-$(date +%Y%m%d-%H%M)"
cp -f "$prof/cordis.patch.yml" "$prof/cordis.patch.yml.bak-$(date +%Y%m%d-%H%M)"
# 老预设目录：里面有你的 persona，换过去之后别急着删
cp -rf "${DSH_HOME:-$HOME/.dsh}/.agent-presets/report" "${DSH_HOME:-$HOME/.dsh}/.agent-presets/report.bak"
```

fork 的源码仓库（如果有）本身就在版本控制里，不用另外备份。

---

## 2. 装原版 AgentTeams（可选——只有要恢复团队模式时才做）

```bash
dsh plugin --profile <profile> add @nanmicoder/dsh-agent-teams@0.1.20
```

这一步会把 profile 里原来那条 `file:...0.1.16-report.4.tgz` 依赖替换成 npm 的原版包，
并同步更新 `dsh.profile.bundles`。

> **先别重启 DSH**：此刻 agent-teams 是原版、补丁还没打，报表模式的三个 memory 工具与
> 队长通知都不存在。第 3 步做完再一起重启。

验证：

```bash
node tools/apply-patch.mjs --mode check --profile desktop
# 期望：· 原版未打补丁（0.1.20） —— 执行 --mode apply 应用
```

---

## 3. 装本插件

### 3.0 外部 MCP 前置

报表模式的 MCP 服务器不随本包分发，换机时先安装：

```bash
git clone https://github.com/SIFU-YE/cpt-mcp.git
cd cpt-mcp && npm install && npm install -g .

git clone https://github.com/SIFU-YE/fr-docx-mcp.git
cd fr-docs-mcp && npm install && npm install -g .

# 回到 dsh-report-mode 目录检查
npm run check:runtime
```

如果安装在非标准位置、PATH 上没有，使用 `<DSH_HOME>/.env`：

```ini
REPORT_CPT_MCP_COMMAND=<cpt-mcp可执行文件或入口>
REPORT_FR_DOCS_MCP_COMMAND=<fr-docs-mcp可执行文件或入口>
```

`dsh-report-mode` 不绑定 DSH 安装位置；`install/install.ps1` 优先读取 `DSH_HOME`，
未设置时回退 `~/.dsh`。

**推荐从任务代码仓库（GitHub）或本地 tgz 安装**：

```bash
# 方式 A：从任务代码仓库（GitHub）安装
dsh plugin --profile <profile> add git+https://github.com/SIFU-YE/dsh-report-mode.git

# 方式 B：本地 tgz（离线 / 无 git 凭据时最稳；<tgz 路径> 换成 npm pack 产物位置）
npm pack                # 在插件仓库根目录执行，产出 dsh-report-mode-<版本>.tgz
dsh plugin --profile <profile> add file:<tgz 路径>
```

报表模式**不需要**安装 `dsh-report-git`，也不需要 Gitee/GitHub 推送凭据；本地 git
工具已内置在 `lib/local-git`（init/status/diff/log/commit/branch），不依赖 host 级插件。
报表产物与 `sandbox*` 历史数据只落本地仓库，不上云。

**若从源码/本地仓库安装本插件**：`cordis.patch.yml` 的 `plugins` 由
`presets/report-mode/agent.cordis.yml` 生成——改完 persona 或预设内插件行，必须运行
`npm run sync:preset`；`npm test`（`sync-preset.mjs --check`）会拦住"只改镜像不改装配源"。

预设以 **DSH 0.2.0 的声明行**随 bundle patch 提供：`cordis.patch.yml` 里插入一行
`id: preset-report-mode` / `name: '@deepseek-ai/dsh-agent-preset'`，其 `plugins` 列表就是
`presets/report-mode/agent.cordis.yml` 的内容（`name`/`description` 取自 `presets/report-mode/preset.yml`）。
装完重启即可在预设选择器里看到「报表模式」。

> **DSH 0.2.0 起不再读 `$DSH_HOME/.agent-presets/<id>/` 目录。** 旧的目录式预设
> （`preset.yml` + `agent.cordis.yml`）已废弃——官方 SKILL 原话是 "Nothing reads that
> directory any more"。所以不要把预设再写到那个目录；`lib/bootstrap.js` 那套目录自举
> 在 0.2.0 上默认停用（`presetAutoInstall: false`）。
>
> **迁移旧预设**：把它变成声明行——`id` 取目录名、`name`/`description`/`order` 取
> `preset.yml`、`plugins` 取 `agent.cordis.yml` 原文，再逐个核对插件名是否改过
> （改名的包会在激活时失败，见 `@deepseek-ai/dsh-agent-preset` 的
> `editing-cordis-compositions` SKILL）。验证 `list_plugins` 里该行是 `active` 后，
> 才删掉旧目录。

---

## 4. 打补丁（可选——只有要恢复团队模式时才做）

```bash
# 先干跑：只验证补丁能应用、产物哈希匹配，不写任何文件
node tools/apply-patch.mjs --mode apply --dry-run --profile desktop

# 再实做
node tools/apply-patch.mjs --mode apply --profile desktop

# 验收
node tools/apply-patch.mjs --mode verify --profile desktop
```

补丁工具会：

1. 校验目标包版本 == `patches/manifest.json` 的基准版本；
2. 校验三个待改文件的归一化 sha256 == `preImage`（不符即拒绝并报差异）；
3. 在内存里归一化行尾 → 应用补丁 → 逐文件比对 `postImage` 哈希；
4. 按目标文件**原有行尾**写回（上游是 CRLF，写回仍是 CRLF）。

要撤销：`node tools/apply-patch.mjs --mode revert --profile desktop`。

---

## 5. 凭据与验收

```bash
# 从模板生成 <DSH_HOME>/.env，然后填真实值
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
cp -f config/report-mode.env.example "$DSH_HOME/.env"
notepad "$DSH_HOME/.env"
```

必填：`REPORT_DORIS_*`（0.1.31 起含 `REPORT_DORIS_DATABASE`：真实 .cpt 的 Doris SQL 有未限定
表名，缺默认库会报 No database selected）、`REPORT_MYSQL_*`。`REPORT_TESTDB_*` 可选。
`REPORT_EXCEL_MCP_PYTHON` 可以不填，缺省用 PATH 上的 `python`。
报表模式只使用本地 git，不需要 `GITEE_CREDENTIALS_FILE` 或任何推送凭据；报表产物只落本地仓库。

cpt-mcp 的真实库连接（`CPT_DB_CONNECTIONS`）由上面的 `REPORT_*` **自动生成**，不需要再维护
`~/.cpt-mcp/db-connections.json`（它只在没有本组变量时兜底）。自动映射的连接名是
`Doris`、`填报-读写` / `MySQL`、`testdb` / `测试库`；**`外接数据库`（FineDB 平台库）、
`FRDemo`、`middle读写` 不在自动映射内**，需要时用 `REPORT_CPT_DB_CONNECTIONS` 整串覆盖
（模板见 `config/report-mode.env.example`）。

**完整重启 DSH（必须退出整个应用再打开，不是仅新开会话）。** Host 在启动时读取 bundle patch
并组合预设；0.1.30 实测：安装完成后新建的报表会话仍挂旧 persona / 旧工具面，只有重启 Host
才会加载新版本。

重启后的验收清单：

- [ ] 预设选择器里出现「报表模式」（id `report-mode`），且能建会话
- [ ] 报表模式可见 goal / plan 能力：`goal` 工具与 `/goal` 命令可用；plan mode 的 `exit_plan_mode` 可用；
- [ ] 旧 `dsh-report-git` 的 `git_commit_all` / `git_repo_status` / `git_rollback` / `git_link_remote` / `git_fetch` / `git_pull` 不可用（或调用被拒绝）；报表模式只能使用内置 local-git 做本地提交；
- [ ] 会话里能看到内置本地 git 工具 `git_init` / `git_status` / `git_diff` / `git_log` /
      `git_commit` / `git_branch`；**不应**出现任何 push / 建远端 / fetch / pull 工具；
      报表产物与 `sandbox*` 历史数据只做本地提交
- [ ] `mcp__cpt-mcp__*` 工具可用；对工作区内的 `.cpt` 调一次 `read_cpt` 不报路径围栏错误
- [ ] `mcp__doris__*` / `mcp__mysql__*` 能查询（说明 `.env` 生效）；配置 `REPORT_DORIS_DATABASE`
      后 `run_dataset_sql_check(target:"real")` 能连上 Doris
- [ ] 工具护栏（0.1.31 起）：`mcp__toolbox__*`、host 团队工具（`spawn_teammate` /
      `wait_agent` / `team_task_*`）不可见；即使可见，调用也返回中文拒绝原因。
      内置本地 git 工具可用于本地提交；报表模式不再有 report-git 工具
- [ ] 浏览器护栏（0.1.31 起）：`mcp__browser__navigate_page` 打开 `http://127.0.0.1:8080`
      或 `http://preview.localhost:8080` 成功，打开 `https://example.com` 被拒绝并返回
      "只允许打开本地预览页"；`evaluate_script` 里 `fetch("https://example.com")` 也被浏览器
      网络层拒绝（说明 `--allowedUrlPattern` 生效）。**该网络层限制需要 Chrome 149+**（本机
      Chrome 156 实测）；Chrome 更旧时 MCP 可能启动失败，见 README「已知限制」的升级/降级说明。
- [ ] 浏览器白名单不含 IPv6：`http://[::1]:8080` 被拒绝（URLPattern 不支持 `[::1]`，工具层与
      网络层保持一致）；如确有 IPv6 预览需求，需要另外评估（目前不支持）。
- [ ] 团队模式已下线（0.1.23 起）：不应出现 `AgentTeams` 角标/队长行为；host 团队工具在报表
      模式被 deny（0.1.31 起）

任何一项不符，先看启动日志里 `dsh-report-mode:` 开头的告警——插件的体检结论会直接
说明是哪一环没到位。

---

## 6. 收尾

确认新预设工作正常后：

1. **删掉旧预设目录** `~/.dsh/.agent-presets/report/`，否则预设选择器里会出现两个都叫
   「报表模式」的条目。旧 persona 若有你想要的内容，先 diff 一下再删。
2. 如果 profile 的 `cordis.patch.yml` 里有一份手写的 `agent-teams` 配置（团队 profile、
   executionPrompt 等），注意**它会盖过插件的 bundle 层配置**（profile 层在 bundle 层
   之后应用）。想用插件提供的默认团队模板，就把那段删掉。
3. 旧 fork 的源码仓库可以留着做参考，但别再往 profile 里装。

---

## 7. 升级路径

> 团队模式已下线，下表中 AgentTeams / 补丁相关的行只在你明确要恢复团队模式时才相关。

| 场景 | 做法 |
| --- | --- |
| 插件升版 | 换 `add` 的版本号（或新的 tgz），重启；预设随 bundle patch 的声明行一起更新 |
| AgentTeams 升版到新的 0.1.x | **先不要升级**。补丁工具会拒绝执行。按 `docs/PATCH.md` 重新生成补丁、更新 manifest 哈希后再升 |
| 想暂时回到原版 AgentTeams | `node tools/apply-patch.mjs --mode revert --profile desktop`，重启 |
| 想彻底卸载 | `dsh plugin --profile desktop remove dsh-report-mode`，再按需 `--mode revert` 补丁。旧的 `.agent-presets/report-mode` 目录在 0.2.0 上不被读取，留着无害，想清理就删 |




