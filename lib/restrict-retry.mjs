/**
 * report-mode 的 schema 隐藏重试 —— 独立模块（2026-11-19）。
 *
 * 为什么单独成文件（不要并回 host-tool-guard.mjs）：
 * Host 进程按 URL 缓存 ESM 模块。热更后新模块若从共享模块 host-tool-guard.mjs
 * 具名导入一个**新增导出**，会在模块链接期抛
 * `does not provide an export named ...`，导致该预设行 fiber 永不创建、
 * 预设报 `agent-preset/invalid ... never started`，新会话全部建不出来
 * （2026-11-18 实测事故）。本文件是**新 URL**、且不 import 共享模块，
 * 旧版 Host 缓存里有没有新导出都不影响加载；三个 restrict-* 行共用它，
 * 避免每个文件各内联一份（两份实现必然漂移）。
 *
 * 为什么要重试：
 * `ctx.tools.restrict({ deny })` 只接受**已经注册**的 global 工具名，名字未知时
 * 官方契约直接抛错（`unknown global tool ...`）。host 团队工具由 profile 级插件在
 * 启动阶段异步注册，toolbox / 旧 report-git 也可能晚于预设行挂载；预设行先于注册
 * 执行时首次 restrict 必然失败。guard（调用时拒绝）是强制层、与注册时序无关，
 * 所以这里只是 best-effort 的「再藏一次 schema」（省上下文、避免模型误试）：
 * 在 1500ms / 5000ms 各补一次 restrict。
 *
 * 安全性：restrict 的 filter 在 dsh-tools 里是 `layer.restrictions.append(...)`，
 * 多个 restrict 调用的 deny 取交集、不会互相覆盖；timer 全部 unref，并在
 * dispose 时 clear，避免拖住宿主退出。
 *
 * @module dsh-report-mode/restrict-retry
 */

/** 启动后延迟重试 schema 隐藏的默认毫秒点。 */
export const RESTRICT_RETRY_DELAYS_MS = Object.freeze([1500, 5000])

/**
 * 安排延迟 restrict 重试（best-effort，失败只告警一次，绝不抛错）。
 *
 * @param {any} ctx - 预设行的 scoped Cordis 上下文。
 * @param {readonly string[]} names - 要 deny 的 global 工具名。
 * @param {string} label - 告警里的对象描述（如 "host 团队工具"）。
 * @param {readonly number[]} [delays] - 毫秒点（测试可覆盖）。
 * @returns {ReturnType<typeof setTimeout>[]} 已安排的 timer（测试/诊断用）。
 */
export function scheduleRestrictRetry(ctx, names, label, delays = RESTRICT_RETRY_DELAYS_MS) {
  let warned = false
  const warnOnce = (error) => {
    if (warned) return
    warned = true
    const detail = error === undefined ? '' : `（${String(/** @type {any} */ (error)?.message ?? error)}）`
    const line = `report-mode: ${label} 的延迟 schema 隐藏未成功（restrict 不可用或工具仍未注册；guard 仍生效）${detail}`
    try {
      if (typeof ctx?.logger?.warn === 'function') {
        ctx.logger.warn(line)
        return
      }
    } catch {
      // logger 本身异常时退回 console，不能因为告警再炸一次。
    }
    console.warn(`dsh-report-mode: ${line}`)
  }

  const timers = delays.map((delay) => {
    const timer = setTimeout(() => {
      try {
        if (typeof ctx?.tools?.restrict !== 'function') {
          throw new Error('tools.restrict 不可用')
        }
        ctx.tools.restrict({ deny: [...names] })
      } catch (error) {
        warnOnce(error)
      }
    }, delay)
    timer.unref?.()
    return timer
  })

  try {
    if (typeof ctx?.effect === 'function') {
      ctx.effect(() => () => {
        for (const timer of timers) clearTimeout(timer)
      })
    }
  } catch {
    // 旧版 Cordis 无 effect 或签名不同：timer 已 unref，不影响进程退出。
  }
  return timers
}
