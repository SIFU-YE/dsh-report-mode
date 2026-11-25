/**
 * report-mode 的 git 工具可见性裁剪 —— 预设内 scoped 行。
 *
 * 报表模式的生产 git 实现是内置的 `dsh-report-mode/local-git`
 * （`git_init` / `git_status` / `git_diff` / `git_log` / `git_commit` / `git_branch`），
 * 只做本地仓库，不提供 push / 建远端 / fetch / pull。
 *
 * 旧版报表模式曾使用 host 级 `dsh-report-git` 的六个工具
 * （`git_commit_all` / `git_repo_status` / `git_rollback` / `git_link_remote` /
 * `git_fetch` / `git_pull`）。其中 `git_commit_all` 会推送已关联的 Gitee 远端，
 * 这正是“报表模式仍然尝试推送 Gitee”的入口。即使当前 profile 已经不安装该插件，
 * 旧会话或残留 host 组合仍可能注册这些名字，所以在这里做强制 deny：
 *   · restrict：best-effort 隐藏 schema；
 *   · guard：调用时强制拒绝（与注册时序无关）。
 *
 * 注意：不能 deny `git_status` / `git_diff` / `git_log` / `git_commit` / `git_branch`
 * 这五个名字；它们同时也是内置 local-git 的工具名。本行只 deny 六个旧 report-git
 * 名字，保证本地提交链路可用。
 *
 * @module dsh-report-mode/restrict-host-git
 */

import { applyDenyRow } from './make-deny-row.mjs'

/** 本行在 Cordis 组合里的插件名。 */
export const name = 'report-mode-restrict-host-git'

/** 依赖的工具注册表。 */
export const inject = ['tools']

/**
 * 旧版 dsh-report-git 提供的远端/推送工具名；报表模式必须全部屏蔽。
 * @type {readonly string[]}
 */
export const REPORT_GIT_TOOLS = Object.freeze([
  'git_commit_all',
  'git_repo_status',
  'git_rollback',
  'git_link_remote',
  'git_fetch',
  'git_pull',
])

/**
 * 被 guard 拒绝时返回给模型的中文原因。
 * @param {string} toolName - 被拒绝的工具名。
 * @returns {string} 拒绝原因。
 */
export function denyReason(toolName) {
  return (
    `report-mode: ${toolName} 属于会关联/推送远端或同步远端的旧 git 工具，本模式已禁用。` +
    '请改用内置本地 git 工具（git_init / git_status / git_diff / git_log / git_commit / git_branch）；' +
    '旧 report-git 推送/远端工具已禁用；本地仓库推送请用内置 git_local_push（仅项目文件夹内本地仓库），不要使用本工具。'
  )
}

// 延迟重试 schema 隐藏与「命中即补隐藏」的三层接线集中在 make-deny-row.mjs（新 URL）。
// 重试实现见 restrict-retry.mjs；不向共享模块 host-tool-guard.mjs 新增导出，避免
// 2026-11-18 的 ESM 链接期事故（Host 按 URL 缓存模块时具名导入「新增导出」会让预设行
// fiber 永不创建）。三个 restrict-* 行统一复用，不各自内联。

/**
 * 对当前 agent scope 施加旧 report-git 工具屏蔽（三层接线见 make-deny-row.mjs）：
 * guard 调用时拒绝（强制）+ 固定窗补隐藏（兜底）+ 命中即补隐藏（事件驱动）。
 * @param {any} ctx - 预设内的 agent scope 上下文（必须 scoped，否则 restrict 会抛）。
 * @returns {{ restricted: boolean, guarded: boolean }} guard/首层 restrict 是否安装成功（供测试断言）。
 */
export function apply(ctx) {
  return applyDenyRow(ctx, { deny: REPORT_GIT_TOOLS, reason: denyReason, label: '旧 report-git 推送工具' })
}
