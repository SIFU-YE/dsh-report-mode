/**
 * report-mode 的宿主记忆工具面收窄 —— 预设内 scoped 行（0.1.49 新增）。
 *
 * 背景（2026-11-21 实测）：宿主 profile 若装 @openviking/dsh-memory-plugin，其 27 个
 * MCP 工具 schema 合计 ~49KB（≈14k tokens），全部进每个报表会话的 tools/list；而真实
 * 报表会话只用检索（find/search/read）、浏览（list/tree）、里程碑写入（remember）
 * 与项目规则检索（rule_search）。其余 20 个 ≈35KB 在报表模式既无用又越界：
 *   · add_resource / download —— 导入外部文件/URL/仓库，与「无公网、外部数据只读」冲突；
 *   · write / edit / add_skill / forget —— viking:// 文件面（报表模式写记忆只走 remember，先脱敏）；
 *   · privacy_* / set_acl / get_acl / list_users / list_groups —— 凭据与账号管理，第 5 条禁碰凭据；
 *   · find_mcp_tools / invoke_mcp_tool —— 跨 MCP 代理调用，绕开本模式的工具裁剪口径；
 *   · glob / grep / health / list_watches / cancel_watch —— 订阅与诊断面，报表会话用不到。
 * persona 第 1 条「记忆只作参考、写入前先脱敏」由此从规则约束升级为工具层强制。
 *
 * 解耦边界：本行只在宿主装了该插件时生效（restrict 未知名字时 fail-open 只告警，
 * guard/固定窗重试/命中即补隐藏机制与 restrict-host-toolbox/git 行完全一致）；
 * 宿主未装时零影响。名单跟随 MCP_SERVER_NAME='openviking' 的 mcp__openviking__<tool>
 * 命名；插件改名或将来新增工具时默认**不 deny**（fail-open 方向），需要再补名单。
 *
 * @module dsh-report-mode/restrict-host-openviking
 */

import { applyDenyRow } from './make-deny-row.mjs'

/** 本行在 Cordis 组合里的插件名。 */
export const name = 'report-mode-restrict-host-openviking'

/** 依赖的工具注册表。 */
export const inject = ['tools']

/**
 * 报表模式保留的宿主记忆工具（7 个）：检索 / 浏览 / 里程碑写入 / 项目规则检索。
 * 覆盖 persona 第 1 条（记忆只作参考）与第 13 条（接手先检索、里程碑先脱敏写入）要用的动作。
 */
export const OV_KEEP_TOOLS = Object.freeze([
  'mcp__openviking__find',
  'mcp__openviking__search',
  'mcp__openviking__read',
  'mcp__openviking__list',
  'mcp__openviking__tree',
  'mcp__openviking__remember',
  'mcp__openviking__rule_search',
])

/**
 * 报表模式屏蔽的宿主记忆工具（20 个，schema 实测 ≈35KB）。
 * 改动名单时同步更新 test/host-guards.test.mjs 的数量断言与 README 工具护栏清单。
 */
export const OV_DENY_TOOLS = Object.freeze([
  'mcp__openviking__add_resource',
  'mcp__openviking__write',
  'mcp__openviking__add_skill',
  'mcp__openviking__set_acl',
  'mcp__openviking__edit',
  'mcp__openviking__privacy_upsert',
  'mcp__openviking__privacy_resolve',
  'mcp__openviking__privacy_tree',
  'mcp__openviking__list_users',
  'mcp__openviking__list_groups',
  'mcp__openviking__list_watches',
  'mcp__openviking__cancel_watch',
  'mcp__openviking__download',
  'mcp__openviking__forget',
  'mcp__openviking__glob',
  'mcp__openviking__grep',
  'mcp__openviking__find_mcp_tools',
  'mcp__openviking__invoke_mcp_tool',
  'mcp__openviking__get_acl',
  'mcp__openviking__health',
])

/**
 * 被 guard 拒绝时返回给模型的中文原因（工具层消息，可点名替代工具，与 toolbox/git 行一致）。
 * @param {string} toolName - 被拒绝的工具名。
 * @returns {string} 拒绝原因。
 */
export function denyReason(toolName) {
  const short = String(toolName).replace(/^mcp__openviking__/, '')
  return (
    `report-mode: 宿主记忆类工具 ${short} 在本模式已收窄（只保留检索/浏览/里程碑写入/项目规则检索）。` +
    '检索请用 find/search/read/list/tree；写记忆请走里程碑通道 remember（先脱敏）；' +
    '导入外部资源、凭据存取、跨服务代理调用不属于报表模式（第 1/4/5 条），不要尝试绕道。'
  )
}

/**
 * 对当前 agent scope 施加宿主记忆工具收窄（三层接线见 make-deny-row.mjs）：
 * guard 调用时拒绝（强制）+ 固定窗补隐藏（兜底）+ 命中即补隐藏（事件驱动）。
 * @param {any} ctx - 预设内的 agent scope 上下文（必须 scoped，否则 restrict 会抛）。
 * @returns {{ restricted: boolean, guarded: boolean }} guard/首层 restrict 是否安装成功（供测试断言）。
 */
export function apply(ctx) {
  return applyDenyRow(ctx, { deny: OV_DENY_TOOLS, reason: denyReason, label: '宿主记忆工具收窄面' })
}
