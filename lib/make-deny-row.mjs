/**
 * 预设内 deny 行的共享装配 —— 三个 restrict-* 行的样板收口（0.1.49）。
 *
 * 三层接线集中在此，行文件只保留自己的名单/拒绝文案/说明：
 *   1. installDenyGuard：guard 调用时强制拒绝（强制层，与注册时序无关）；
 *   2. scheduleRestrictRetry：1500/5000ms 固定窗补隐藏（时间窗兜底，见 restrict-retry.mjs）；
 *   3. onDeny「命中即补隐藏」：**事件驱动**根治 P1-2 固定窗 fail-open——guard 回调被
 *      命中意味着该名字此刻必然已注册（这是比任何时间窗都精确的信号），立即对该名字
 *      补一次 restrict。每个名字只试一次，失败只告警，不影响 guard 拒绝语义。
 *
 * ESM 纪律（2026-11-18 事故教训）：本文件是**新 URL**；host-tool-guard.mjs 只新增了
 * 「可选参数 onDeny」、没有新增导出，老宿主缓存其旧版时本模块照常链接——旧版忽略
 * onDeny，「命中即补隐藏」在宿主重启后才生效（重启本就是预设变更的既定生效方式）。
 *
 * @module dsh-report-mode/make-deny-row
 */

import { installDenyGuard, warn } from './host-tool-guard.mjs'
import { scheduleRestrictRetry } from './restrict-retry.mjs'

/**
 * 共享的 deny 行装配：guard 拒绝 + 固定窗重试 + 命中即补隐藏，一次接好。
 * @param {any} ctx - 预设行的 scoped Cordis 上下文。
 * @param {object} options
 * @param {readonly string[]} options.deny - 要拒绝的 global 工具名。
 * @param {string | ((toolName: string) => string)} options.reason - 拒绝原因。
 * @param {string} options.label - 告警里的对象描述。
 * @returns {{ restricted: boolean, guarded: boolean }} guard/首层 restrict 是否安装成功（供测试断言）。
 */
export function applyDenyRow(ctx, { deny, reason, label }) {
  const patched = new Set()
  const result = installDenyGuard(ctx, {
    deny,
    reason,
    label,
    onDeny: (toolName) => {
      // guard 命中 = 该名字必然已注册：立即补一次 schema 隐藏；每名只试一次。
      if (patched.has(toolName)) return
      patched.add(toolName)
      try {
        if (typeof ctx?.tools?.restrict !== 'function') {
          throw new Error('tools.restrict 不可用')
        }
        ctx.tools.restrict({ deny: [toolName] })
      } catch (error) {
        warn(ctx, `${label} 的「命中即补隐藏」失败：${toolName}（guard 拒绝仍生效）`, error)
      }
    },
  })
  scheduleRestrictRetry(ctx, deny, label)
  return result
}
