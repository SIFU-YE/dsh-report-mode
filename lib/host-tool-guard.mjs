/**
 * 预设内工具护栏的共享实现：schema 隐藏（best-effort）+ 调用时拒绝（强制）。
 *
 * 背景（0.1.31 实测结论）：`ctx.tools.restrict({ deny })` 只能 deny **已经注册**的
 * global 工具名；名字未知时官方契约是直接抛错（"unknown names ... fail"）。MCP 工具是
 * **异步注册**的（stdio 进程起完、tools/list 回来才注册），而预设行在 Host 组合阶段
 * 就挂载了 —— 所以对 `mcp__toolbox__*` 这类异步工具，restrict 在启动时序上很可能
 * fail-open（只留一条 warn，工具仍可见可调）。0.1.30 的实现正是如此。
 *
 * 0.1.31 起采用两层：
 *   1. `restrict()`：仍调用一次，作为 schema 隐藏的 best-effort（成功时模型连工具都
 *      看不到，省上下文；失败只告警，不阻断启动）。
 *   2. `guard()`：**强制层**。官方语义是「在 tools/pre-execute waterfall 之后、执行之前
 *      同步执行；返回字符串即拒绝执行」。它与工具注册时序无关——只要 agent 的 scope
 *      链上有本预设 guard layer，调用就一定经过它；且 guard 是单调的，不能被别的
 *      guard 强制放行。本预设行注册在 scoped context 上，只作用于加入报表模式 scope
 *      的 agent（官方：plain-context guard 全局生效，经 agent.ctx/预设 scope 注册的只
 *      作用于该 scope 链——`ToolRuntime.guard()` 内部就是 `layers.effect(this.ctx, …)`）。
 *
 * 参数形状防御：guard 回调收到的是 `ToolExecution extends ToolExecutionInput`
 * （`{ callId, rootCallId?, name, schema?, arguments, agent?, parent?, signal, token }`），
 * 但这里是跨版本边界（DSH 0.2.0-rc 曾改过字段），所以名字/参数都做多形状兜底：
 *   name = execution.name ?? execution.toolName ?? execution.tool?.name ?? execution.call?.name
 *   args = execution.arguments ?? execution.args ?? execution.input ?? execution.parameters
 * 任何字段缺失都视为「无法判定」，对应护栏放行（宁可少挡，不可误杀正常工具）。
 *
 * @module dsh-report-mode/host-tool-guard
 */

/**
 * 从 guard 回调参数里尽力取出工具名。
 * @param {unknown} execution - `ToolExecution`（或旧版/变体形状）。
 * @returns {string} 工具名；取不到时返回空串。
 */
export function normalizeToolName(execution) {
  const executionLike = /** @type {any} */ (execution)
  const name =
    executionLike?.name ??
    executionLike?.toolName ??
    executionLike?.tool?.name ??
    executionLike?.call?.name
  return typeof name === 'string' ? name : ''
}

/**
 * 从 guard 回调参数里尽力取出解析后的调用参数。
 * @param {unknown} execution - `ToolExecution`（或旧版/变体形状）。
 * @returns {Record<string, unknown>} 参数对象；取不到时返回空对象。
 */
export function normalizeToolArguments(execution) {
  const executionLike = /** @type {any} */ (execution)
  const args =
    executionLike?.arguments ??
    executionLike?.args ??
    executionLike?.input ??
    executionLike?.parameters ??
    executionLike?.call?.arguments
  return args !== null && typeof args === 'object' ? args : {}
}

/**
 * 统一告警出口：优先用 Cordis logger，退回 console。绝不抛错。
 * @param {any} ctx - 预设行的 Cordis 上下文。
 * @param {string} message - 中文告警正文。
 * @param {unknown} [error] - 触发原因。
 */
export function warn(ctx, message, error) {
  const detail = error === undefined ? '' : `（${String(/** @type {any} */ (error)?.message ?? error)}）`
  const line = `report-mode: ${message}${detail}`
  try {
    if (typeof ctx?.logger?.warn === 'function') {
      ctx.logger.warn(line)
      return
    }
  } catch {
    // logger 本身异常时走 console，不能因为告警再炸一次。
  }
  console.warn(`dsh-report-mode: ${message}${detail}`)
}

/**
 * best-effort：隐藏 schema（工具名尚未注册时只告警）。
 * @param {any} ctx - 预设行的 Cordis 上下文。
 * @param {readonly string[]} names - 要 deny 的 global 工具名。
 * @param {string} label - 告警里的对象描述（如 "host toolbox"）。
 * @returns {boolean} 是否成功调用 `restrict()`。
 */
export function restrictBestEffort(ctx, names, label) {
  try {
    if (typeof ctx?.tools?.restrict !== 'function') {
      warn(ctx, `tools.restrict 不可用，跳过 ${label} 的 schema 隐藏`)
      return false
    }
    ctx.tools.restrict({ deny: [...names] })
    return true
  } catch (error) {
    // 常见原因：MCP 工具尚未完成 tools/list（异步注册）、对应 host 插件没装。
    // 这不再是唯一防线——guard 层仍会在调用时拒绝，故这里只告警。
    warn(ctx, `跳过 ${label} 的 schema 隐藏（restrict 失败，guard 仍生效）`, error)
    return false
  }
}

/**
 * 注册调用时守卫（强制层）。回调异常一律吞掉并放行，避免护栏影响正常工具。
 * @param {any} ctx - 预设行的 Cordis 上下文。
 * @param {(execution: unknown) => string | undefined} check - 返回字符串即拒绝。
 * @param {string} label - 告警里的对象描述。
 * @returns {boolean} 是否成功注册。
 */
export function installGuard(ctx, check, label) {
  if (typeof ctx?.tools?.guard !== 'function') {
    warn(ctx, `tools.guard 不可用，${label} 的调用时拒绝未启用`)
    return false
  }
  try {
    ctx.tools.guard((execution) => {
      try {
        const reason = check(execution)
        return typeof reason === 'string' && reason.length > 0 ? reason : undefined
      } catch (error) {
        warn(ctx, `${label} 的 guard 判断异常，本次调用放行`, error)
        return undefined
      }
    })
    return true
  } catch (error) {
    warn(ctx, `注册 ${label} 的调用时拒绝失败`, error)
    return false
  }
}

/**
 * 两层安装：restrict（best-effort，隐藏 schema）+ guard（强制，调用时拒绝）。
 * @param {any} ctx - 预设行的 Cordis 上下文。
 * @param {object} options
 * @param {readonly string[]} options.deny - 要拒绝的 global 工具名。
 * @param {string | ((toolName: string) => string)} options.reason - 拒绝原因（按工具名生成）。
 * @param {string} options.label - 告警里的对象描述。
 * @returns {{ restricted: boolean, guarded: boolean }}
 */
export function installDenyGuard(ctx, { deny, reason, label }) {
  const denied = new Set(deny.map((name) => String(name)))
  const restricted = restrictBestEffort(ctx, deny, label)
  const guarded = installGuard(
    ctx,
    (execution) => {
      const name = normalizeToolName(execution)
      if (!denied.has(name)) return undefined
      return typeof reason === 'function' ? reason(name) : reason
    },
    label,
  )
  return { restricted, guarded }
}

/**
 * `ctx.tools.guard` 的可用性探测（测试与文档用）。
 * @param {any} ctx - 预设行的 Cordis 上下文。
 * @returns {boolean} tools.guard 是否为函数。
 */
export function hasGuard(ctx) {
  return typeof ctx?.tools?.guard === 'function'
}
