/**
 * 会话工作区文件护栏（delete_file / copy_file 共用的纯函数，2026-11-23）。
 *
 * 为什么单独成模块：
 *   · `delete_file` 与新增的 `copy_file` 的安全语义必须逐条一致（仅工作区内、
 *     拒绝受保护路径段），把判定放在同一处可避免两份清单各自漂移；
 *   · 行模块 import `@deepseek-ai/dsh-tools`，仓库内不可解析，无法直接单测；
 *     本模块不依赖宿主，测试可直接覆盖「工作区外 / 受保护路径段」判定。
 * @module dsh-report-mode/fs-guards
 */
import { sep, resolve } from 'node:path'

/** 受保护的路径段：出现任意一段即拒绝访问（大小写不敏感）。 */
export const PROTECTED_SEGMENTS = new Set([
  '.git', 'node_modules', '.reasonix', '.agent-teams', '.trash', '.decompiled',
  '.bak', '.dsh', 'artifacts',
])

/** 会话工作区：优先取 agent 会话 cwd，回退 process.cwd()（与 tool-fs 的 sessionCwd 同源）。 */
export function workspaceOf(exec) {
  return exec?.agent?.session?.header?.cwd ?? process.cwd()
}

/** 目标是否落在会话工作区内（含工作区根自身）。 */
export function withinWorkspace(abs, ws) {
  const root = resolve(ws)
  return abs === root || abs.startsWith(root + sep)
}

/** 命中的受保护路径段；没有返回 undefined。 */
export function protectedSegmentOf(abs) {
  const parts = abs.split(/[\\/]/).map((s) => s.toLowerCase())
  return parts.find((p) => PROTECTED_SEGMENTS.has(p))
}
