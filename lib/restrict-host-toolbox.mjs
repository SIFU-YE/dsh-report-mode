/**
 * report-mode 的工具可见性裁剪 —— 预设内 scoped 行。
 *
 * 把 **host 级** mcp-toolbox（profile 根级 `insert` 的 `@deepseek-ai/dsh-mcp-client`，
 * `serverName: toolbox`）注册的三个 query 工具从「报表模式」的会话里屏蔽掉。
 *
 * 为什么需要它：报表模式自己挂了 `doris` / `mysql` / `testdb` 三个 MCP（各 4 工具，含
 * `describe_table` / `list_tables`），与 toolbox 的 3 个 query 工具指向同一批库；toolbox 是
 * Host 级行、对**所有**预设可见，报表模式必须显式 deny，否则 15 个 DB 工具同场，persona 又只
 * 描述后三者且规定"不调用清单外工具"——形成"可见但被规则禁止"，还诱发选错连接
 * （v1 会话 1,566 次工具调用里 toolbox 0 次，全是 mcp__mysql__ / mcp__doris__）。
 *
 * 机制（0.1.31 起两层，官方语义见 `@deepseek-ai/dsh-tools` 的 `restrict()` / `guard()`）：
 *   - `restrict()` 只 deny **已经注册**的 global 工具名，名字未知直接抛错。MCP 工具是异步
 *     注册的（stdio 起来、tools/list 回来才有），预设挂载时往往还没注册 —— 所以 0.1.30 的
 *     单层 restrict 会 fail-open（工具仍可见可调）。
 *   - `guard()` 在每次调用前同步执行，与注册时序无关，返回字符串即拒绝；本行注册在预设
 *     scoped context 上，只作用于报表模式的 agent。**这才是强制层**。
 *   - `restrict()` 保留为 best-effort：成功时 schema 都不展示（省上下文），失败只告警。
 *   - 两层都 fail-open（异常只告警），绝不让报表模式启动失败。
 * @module dsh-report-mode/restrict-host-toolbox
 */

import { installDenyGuard } from './host-tool-guard.mjs'

/** 本行在 Cordis 组合里的插件名。 */
export const name = 'report-mode-restrict-host-toolbox'

/** 依赖的工具注册表。 */
export const inject = ['tools']

/**
 * 需要从报表模式屏蔽的 host 级 mcp-toolbox 工具名。
 * 与 `<DSH_HOME>/toolbox/tools.yaml` 的 `kind: tool` 定义一一对应（tools.yaml 改名时这里也要改）。
 */
export const HOST_TOOLBOX_TOOLS = Object.freeze([
  'mcp__toolbox__doris_query',
  'mcp__toolbox__report_query',
  'mcp__toolbox__test_query',
])

/**
 * 被 guard 拒绝时返回给模型的中文原因。
 * @param {string} toolName - 被拒绝的工具名。
 * @returns {string} 拒绝原因。
 */
export function denyReason(toolName) {
  return (
    `report-mode: host 级 ${toolName} 在本模式已禁用（toolbox 与 doris/mysql/testdb 同库重复）。` +
    '请改用 mcp__doris__ / mcp__mysql__ / mcp__testdb__ 的 execute_query / list_tables / ' +
    'describe_table 等工具，不要尝试绕道。'
  )
}

/**
 * 对当前 agent scope 施加工具屏蔽：restrict 隐藏 schema（best-effort）+ guard 调用时拒绝（强制）。
 * @param {any} ctx - 预设内的 agent scope 上下文（必须 scoped，否则 restrict 会抛）。
 * @returns {{ restricted: boolean, guarded: boolean }} 两层是否安装成功（供测试断言）。
 */
export function apply(ctx) {
  return installDenyGuard(ctx, {
    deny: HOST_TOOLBOX_TOOLS,
    reason: denyReason,
    label: 'host toolbox 工具',
  })
}
