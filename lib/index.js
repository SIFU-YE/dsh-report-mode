/**
 * dsh-report-mode —— 报表模式插件（host 半区）。
 *
 * 本插件承担三件事：
 * 1. 随包预设的自举：把 `presets/report-mode` 落到 `<DSH_HOME>/.agent-presets/report-mode`，
 *    让「报表模式」出现在预设列表里（见 lib/bootstrap.js 说明为何必须以数据落盘）。
 * 2. 体检：AgentTeams 适配链路的状态。
 * 3. 预设内本地 git 工具由 `lib/local-git`（`dsh-report-mode/local-git`）提供：
 *    `git_status` / `git_diff` / `git_log` / `git_commit` / `git_branch`，无 push/远端。
 *    0.1.42 起不再依赖外部 `dsh-plugin-git-workflow` 或 `dsh-report-git`。
 *
 * AgentTeams 的报表模式适配（命令-only、队长通知、scoped memory）**不在本包内**：
 * 本插件依赖 npm 原版包，只通过 patches/ 下的补丁文件落地那三处结构性改动；
 * 背景色标识与成员规则文本则分别由本包的 client 半区与 preset 配置承担，零补丁。
 * @module dsh-report-mode
 */
import { checkAgentTeamsPatch, installBundledPreset } from './bootstrap.js'

export const name = 'dsh-report-mode'

/**
 * 组合本插件的能力。任何一步失败都只影响它自己，不阻断插件启动。
 * @param ctx - 插件上下文（只用 logger，可缺省）。
 * @param config - 行配置：`presetAutoInstall`（默认 true）落预设、
 *   `patchCheck`（默认 true）体检 AgentTeams。
 */
export function apply(ctx, config = {}) {
  installBundledPreset(ctx, config)
  if (config.patchCheck !== false) checkAgentTeamsPatch(ctx)
}
