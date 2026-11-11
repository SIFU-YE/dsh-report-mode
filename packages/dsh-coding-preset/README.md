# dsh-coding-preset

把旧的目录式用户预设 `$DSH_HOME/.agent-presets/coding/`（「编码（Git Bash）」）迁移成
**DSH 0.2.0 的 `@deepseek-ai/dsh-agent-preset` 声明行**，让它在 0.2.0 的预设选择器里重新出现。

## 为什么需要它

DSH 0.2.0 起**不再读** `$DSH_HOME/.agent-presets/<id>/` 目录式预设（`preset.yml` +
`agent.cordis.yml`）。官方 SKILL `@deepseek-ai/dsh-agent-preset/skills/editing-cordis-compositions`
的原话：

> Before declaration rows, a user preset was a directory `$DSH_HOME/.agent-presets/<id>/` …
> **Nothing reads that directory any more.**

预设现在必须以 `@deepseek-ai/dsh-agent-preset` 声明行的形式**随 bundle patch 下发**。
所以原本只存在于 `.agent-presets/coding/` 的那份预设，在 0.2.0 上就看不到了。

## 这个 bundle 提供什么

| | |
| --- | --- |
| 预设 id | `coding`（取自原目录名） |
| 显示名 | 编码（Git Bash）（取自原 `preset.yml`） |
| Loader 行 id | `preset-coding` |
| `order` | 20（内置 preset 用了 1–4） |
| `plugins` | 由 `presets/coding/agent.cordis.yml` 原样迁移，18 条顶层插件、含嵌套共 31 条 |

内容与迁移前完全一致：完整的编码 Agent（文件编辑、Shell、检索、Skills、计划、目标、
子代理与工作流），shell 显式用 Git Bash（`tool-bash` 启用、`tool-pwsh` 关闭），
与报表模式（report-mode，无 shell）互为配套。

## 迁移期改名（1 处，必须）

上游改过包名，旧预设里那个名字在 0.2.0 上**解析不到，会在激活时失败**：

| | 旧（0.1.x） | 新（0.2.0） |
| --- | --- | --- |
| entry id | `workflow-worker-thread` | `workflow-ptc` |
| package name | `@deepseek-ai/dsh-workflow-worker-thread` | `@deepseek-ai/dsh-workflow-ptc` |

依据是 0.2.0 内置的 `@deepseek-ai/dsh-web-app/presets/standard.patch.yml` 的 `delegation` 组。
其余 26 个插件名逐一核对过，全部在 0.2.0-rc.2 上解析成功，未作改动。

`presets/coding/agent.cordis.yml` **保留未改的原文**作为迁移来源存档，
改动只体现在 `cordis.patch.yml` 的声明行里（文件头部已注明）。

## 安装

它作为 `sifu-ye/dsh-report-mode` 仓库里的**伴随包**发布（`packages/dsh-coding-preset`），
独立于插件本体——插件包的 `files` 不含 `packages/`，所以打包发布时不会被带进
`dsh-report-mode` 的 tarball。装包路径指向这个子目录即可：

```powershell
# 在有 plugin_manager 的 DSH 会话里，或用 dsh CLI（<本包路径> 换成你 clone 下来的 packages/dsh-coding-preset 目录）：
dsh plugin --profile <profile> add file:<本包路径>
```

装完重启 DSH（或刷新页面重跑 web boot），预设选择器里应出现「编码（Git Bash）」。

验收：

- [ ] `list_plugins` 里 `include:preset-coding` 行是 `fiberPhase: active`
- [ ] 预设选择器里出现「编码（Git Bash）」（id `coding`），且能建会话
- [ ] 会话里 `tool-bash` 可用、`tool-pwsh` 不在工具表里

## 迁移其他旧预设

同一个套路：`id` 取目录名、`name`/`description`/`order` 取 `preset.yml`、`plugins` 取
`agent.cordis.yml` 原文，再**逐个核对插件名是否改过**（改名的包会在激活时失败），
最后验证 `list_plugins` 里该行 `active` 才算完成。

## 许可证

MIT。
