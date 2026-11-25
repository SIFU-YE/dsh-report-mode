# AgentTeams 适配补丁

本插件对 `@nanmicoder/dsh-agent-teams` 的报表模式适配，全部集中在
`patches/dsh-agent-teams-0.1.20-report.patch`（unified diff，4 个文件、7 个 hunk、
195 行新增 / 2 行删除）。

- 基准版本：**0.1.20**（原版 npm 包，不是 fork）
- 版本锁：`patches/manifest.json` 记录了三个待改文件的归一化 sha256（`preImage`）
  与四个产物文件的哈希（`postImage`）。任一不符，`apply-patch.mjs` 拒绝执行。
- 执行器：`tools/apply-patch.mjs`（自带 unified-diff 应用器，不依赖 git）

> **0.1.3 起状态变更**：预设与插件配置已改写为不依赖本补丁（上游 0.1.20
> 默认没有 memory 三件套，跨成员信息由队长汇总转达）。本补丁改为**可选项**，
> 仅在需要旧行为（scoped memory、队长通知、命令-only 手势边界）时按 §3 应用；
> 下文保留全部重放步骤不变。

---

## 1. 逐项说明

### 1.1 `lib/index.js` — 命令-only

```diff
@@ -139,7 +139,9 @@ export function apply(ctx, config) {
         ctx.inject(['commands'], (commandCtx) => {
             registerAgentTeamsCommand(commandCtx, () => config.profiles ?? {});
         });
-        installAgentTeamsGestureBoundary(ctx, () => config.profiles ?? {});
+        // dsh-report-mode: 报表模式要求「命令-only」——只保留 /agent-teams 斜杠命令，
+        // 关闭自然语言手势触发，避免报表模式下被普通叙述误触发团队创建。
+        // installAgentTeamsGestureBoundary(ctx, () => config.profiles ?? {});
```

**为什么必须补丁**：上游 `slashCommand` 开关同时管住「斜杠命令」和「自然语言手势」两件事，
没有单独关掉后者的配置项。报表模式下成员规则与 persona 里会出现大量"团队/成员/交付"
这类词，保留手势边界会让普通叙述被误判成开团指令。

**替代方案（已否）**：配置层 `slashCommand: false` 能关掉手势，但连命令一起关掉，
报表模式就再也开不了团。

### 1.2 `lib/tool-names.js` — 把三个 memory 工具纳入工具名清单

给 `TEAM_TOOL_NAMES` 加上 `agent_teams_memory_write`、`agent_teams_memory_read`、
`agent_teams_grant_memory`；给 `MEMBER_TOOL_NAMES` 加上前两个。

**注意版本差异**：0.1.20 起工具名集中在本文件；fork 基于的 0.1.16 是把名字写在
`index.ts` 的字面量数组里，所以**从 fork 移植时这一处必须改到新位置**，否则会出现
"工具注册了但成员看不到 / 能力门禁把它当成队长专属"这类不一致。

能力门禁的逻辑是 `capabilities.js` 的
`deny: TEAM_TOOL_NAMES.filter(n => !MEMBER_TOOL_NAMES.includes(n))`：
放进 `TEAM_TOOL_NAMES` 才进队长 usage 提示，放进 `MEMBER_TOOL_NAMES` 才对成员开放。
`grant_memory` 刻意**只**进前者——授权是队长专属。

### 1.3 `lib/tools.js` — 队长通知 + 三个工具注册

**(a) 成员间消息同步通知队长**（`agent_teams_send_message` 的成员分支）

在原有 `'agent-teams/message-sent'` 事件之后，追加一条 durable 通知进队长邮箱：

```js
const notification = createMessage(from, CAPTAIN_KEY, `[teammate-message] ${from} -> ${recipient.name}: ${args.content}`)
appendMailbox(...)
appendTeamEvent(..., 'agent-teams/message-notify', {...})
return { kind: 'member', fresh, identity, message, from, recipient, notification }
```

出锁后再尝试实时投递，失败退回邮箱（`markMailboxDelivered` / `releaseMailboxDelivery`）：

```js
steerCaptainReport(captain, `${from}->${recipient.name}`, text, mailboxPrompt(prepared.fresh.id, CAPTAIN_KEY, [prepared.notification]))
```

**为什么必须补丁**：`steerCaptainReport` / `appendMailbox` / `requireParticipantTeam`
都是包内私有函数，包只导出 `name`/`inject`/`Config`/`usageSectionText`/`apply`，
也从不用 `ctx.provide` 发布任何服务——外部插件拿不到这些能力。

**(b) 三个工具注册**：`agent_teams_memory_write` / `agent_teams_memory_read` /
`agent_teams_grant_memory`，插在 `agent_teams_status` 之前，复用包内已有的
`requireCaptain` / `workspaceOf` / `stateRootOf` / `requireParticipantTeam` /
`withTeamLock` / `requireFreshParticipant` / `requireMember`，所以锁语义与既有工具一致。

### 1.4 `lib/memory.js` — 新增文件

分域记忆池的存储层（91 行，纯 JS）：

- 每个成员一份 JSONL：`<stateDir>/<teamId>/memory/<member>.jsonl`
- 授权表：`<stateDir>/<teamId>/memory/grants.json`
- 导出 `MEMORY_DIR` / `GRANTS_FILE` / `MEMORY_CAPTAIN_KEY` / `appendMemory` /
  `readMemory` / `readGrants` / `grantMemory` / `canReadMemory`

对应 fork 里的 `src/memory.ts`，逐字移植（含语义）。

---

## 2. 刻意**不在**补丁里的部分

| 项目 | 落点 | 理由 |
| --- | --- | --- |
| 队长会话深色背景 / 角标 | 本包 `client/index.js` | 只用 `/plugins/dsh-agent-teams/state` 路由 + `ctx.sessions` + `ctx.effect` 等公开接口，不需要内部状态 |
| 成员 / 队长协作规则文本 | `cordis.patch.yml` 的 `executionPrompt` | 上游支持全局/按 profile/按成员三级配置，无需改源码（fork 当年是直接改 `src/members.ts`） |
| 报表团队 profile 模板 | `cordis.patch.yml` 的 `agent-teams` 行 | 纯配置 |
| 命令-only 的另一半（不注册斜杠命令） | —— | 上游 `slashCommand` 已支持，且报表模式需要保留命令 |

把 D、E 外移之后，补丁从"一份 fork 的 diff"缩到 4 个文件，其中只有 2 处是真正的
行为改动（1.1 与 1.3a）。

---

## 3. 上游升版后如何重新生成补丁

补丁工具**不会**在版本不符时硬打（会拒绝并报差异），所以上游一发新版就需要下面的流程。

### 3.1 准备一个干净的重放工作区

```bash
mkdir -p /tmp/patchwork && cd /tmp/patchwork
npm pack @nanmicoder/dsh-agent-teams@<新版本>      # 或 npm i 后从 node_modules 取
tar -xzf nanmicoder-dsh-agent-teams-<新版本>.tgz
git init . && git add -A && git commit -m "pristine @nanmicoder/dsh-agent-teams@<新版本>"
```

### 3.2 手工重放四处改动

把 1.1 / 1.2 / 1.3 / 1.4 的改动按新版本的文件结构重放一遍。多数情况下是同一位置；
`lib/tool-names.js` 这类"上游重构过"的文件需要重新定位锚点。

### 3.3 生成新补丁并更新 manifest

```bash
git add -N lib/memory.js                 # 让新增文件也进 diff
git diff > patches/dsh-agent-teams-<新版本>-report.patch
```

然后在 `patches/manifest.json` 里：改 `version` 与 `patch` 文件名，重算并替换
`preImage` / `postImage`（脚本会给期望值，直接把实际值抄进去之前**先确认差异是预期的**）：

```bash
node -e "
const {createHash}=require('node:crypto'),{readFileSync}=require('node:fs');
const h=f=>createHash('sha256').update(readFileSync(f,'utf8').replace(/\r\n/g,'\n'),'utf8').digest('hex');
for (const f of ['lib/index.js','lib/tool-names.js','lib/tools.js','lib/memory.js'])
  console.log(f, h(f));
"
```

同时更新 `lib/bootstrap.js` 里的 `SUPPORTED_AGENT_TEAMS_VERSION`。

### 3.4 验收

```bash
# 对着模拟目录（不是线上 profile）跑完整链路
rm -rf /tmp/sim && mkdir -p /tmp/sim/node_modules/@nanmicoder
cp -r /tmp/upcheck/package /tmp/sim/node_modules/@nanmicoder/dsh-agent-teams
node tools/apply-patch.mjs --package-dir /tmp/sim/node_modules/@nanmicoder/dsh-agent-teams --mode check
node tools/apply-patch.mjs --package-dir /tmp/sim/node_modules/@nanmicoder/dsh-agent-teams --mode apply --dry-run
node tools/apply-patch.mjs --package-dir /tmp/sim/node_modules/@nanmicoder/dsh-agent-teams --mode apply
node tools/apply-patch.mjs --package-dir /tmp/sim/node_modules/@nanmicoder/dsh-agent-teams --mode verify
node tools/apply-patch.mjs --package-dir /tmp/sim/node_modules/@nanmicoder/dsh-agent-teams --mode revert
```

`--package-dir` 存在就是为了这件事：**永远先对着模拟目录演练，不要直接拿线上 profile 试**。

### 3.5 别忘了

- 真的在线上 profile 打补丁之前先重启一次、确认原版 agent-teams 能正常工作；
- 补丁进的是 `node_modules`，`dsh plugin ... install` 或升级会把它冲掉，需要重打；
- `docs/INSTALL.md` 的升级表格里说明了这一约束。

---

## 4. 长期方向：让补丁归零

补丁里真正"结构性"的只有三处（A 命令-only、B 队长通知、C 分域记忆）。
合理的上游化路径是给 AgentTeams 提三个开关：

| 建议开关 | 语义 | 对应补丁段 |
| --- | --- | --- |
| `gestureBoundary: false` | 只关自然语言手势，保留斜杠命令 | 1.1 |
| `captainNotify: 'member-messages'` | 成员间消息同步通知队长 | 1.3a |
| `scopedMemory: true` | 启分域记忆与授权工具（含 1.4 的存储层） | 1.2 + 1.3b + 1.4 |

三个开关一旦落地，本插件就能删掉 `patches/`、`tools/apply-patch.mjs` 和
`lib/bootstrap.js` 里的补丁体检，只剩纯配置 + 预设 + git 工具。
在那之前，这份补丁是"不 fork 上游"和"报表模式要的功能"之间最小代价的折中。
