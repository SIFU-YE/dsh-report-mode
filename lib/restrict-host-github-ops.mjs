/**
 * report-mode 的工具可见性裁剪 —— 预设内 scoped 行。
 *
 * 把 **host 级** `@goodandready/dsh-github-ops`（profile 根级 `insert`，对所有预设可见）
 * 注册的 GitHub 操作工具从「报表模式」的会话里屏蔽掉：报表模式没有 shell、没有发布职责，
 * 也不需要读写仓库/PR/Release；这类工具出现在 schema 里只会诱导模型越界。
 *
 * 机制（与 restrict-host-toolbox 同一套两层）：
 *   - `restrict()` 只隐藏**已注册**的名字（best-effort，异步/未安装时只告警）；
 *   - `guard()` 在每次调用前按前缀 `gh_` 强制拒绝（与注册时序无关，覆盖插件后续新增工具）；
 *   - 固定窗重试覆盖插件启动/注册时序。
 * 两层都 fail-open（异常只告警），绝不让报表模式启动失败。
 * @module dsh-report-mode/restrict-host-github-ops
 */

import { installGuard, normalizeToolName, restrictBestEffort } from './host-tool-guard.mjs'
import { scheduleRestrictRetry } from './restrict-retry.mjs'

/** 本行在 Cordis 组合里的插件名。 */
export const name = 'report-mode-restrict-host-github-ops'

/** 依赖的工具注册表。 */
export const inject = ['tools']

/** host 级 github-ops 工具的统一前缀（guard 的前缀判定依据）。 */
export const HOST_GITHUB_OPS_PREFIX = 'gh_'

/**
 * 需要从报表模式屏蔽的 host 级 github-ops 工具名（与插件 0.6.19 的注册表一一对应）。
 * 插件新增工具时同步补充；guard 的前缀匹配会先兜住，这里用于 schema 隐藏与测试。
 */
export const HOST_GITHUB_OPS_TOOLS = Object.freeze([
  'gh_api',
  'gh_auth_finish',
  'gh_auth_login',
  'gh_auth_logout',
  'gh_auth_status',
  'gh_branch_protection_delete',
  'gh_branch_protection_get',
  'gh_branch_protection_set',
  'gh_changelog_generate',
  'gh_checks',
  'gh_commits',
  'gh_community_scaffold',
  'gh_compare',
  'gh_contributors',
  'gh_delete_branch',
  'gh_delete_file',
  'gh_dependabot_alert_view',
  'gh_deployment_create',
  'gh_deployment_list',
  'gh_deployment_status_create',
  'gh_discussion_comment',
  'gh_discussion_create',
  'gh_discussion_list',
  'gh_discussion_view',
  'gh_environment_list',
  'gh_explore',
  'gh_file',
  'gh_find_repos',
  'gh_generate_pr_summary',
  'gh_help',
  'gh_issue',
  'gh_issue_mirror_sync',
  'gh_issue_search',
  'gh_matrix_status',
  'gh_mirror_check',
  'gh_mirror_publish',
  'gh_mirror_status',
  'gh_mirror_sync',
  'gh_notifications',
  'gh_pull_commit_signatures',
  'gh_push_files',
  'gh_release_asset_delete',
  'gh_release_asset_list',
  'gh_release_asset_upload',
  'gh_release_create',
  'gh_release_delete',
  'gh_release_edit',
  'gh_release_list',
  'gh_release_notes_generate',
  'gh_release_preflight',
  'gh_release_view',
  'gh_repo',
  'gh_repo_create',
  'gh_repo_edit',
  'gh_repo_health',
  'gh_repo_report',
  'gh_repo_search',
  'gh_repo_tree',
  'gh_review',
  'gh_review_job',
  'gh_review_job_status',
  'gh_ruleset_apply',
  'gh_ruleset_delete',
  'gh_ruleset_list',
  'gh_ruleset_view',
  'gh_run_cancel',
  'gh_run_diagnose',
  'gh_run_dispatch',
  'gh_run_failure_inspector',
  'gh_run_jobs',
  'gh_run_list',
  'gh_run_log_summary',
  'gh_run_logs',
  'gh_run_rerun',
  'gh_run_view',
  'gh_search',
  'gh_secret_delete',
  'gh_secret_list',
  'gh_secret_set',
  'gh_security_alerts',
  'gh_tag_create',
  'gh_tag_delete',
  'gh_tag_list',
  'gh_token_audit',
  'gh_trending',
  'gh_triage_external_issues',
  'gh_upload_project',
  'gh_user_repos',
  'gh_variable_delete',
  'gh_variable_list',
  'gh_variable_set',
  'gh_webhook_simulate',
  'gh_weekly_digest',
])

/**
 * 被 guard 拒绝时返回给模型的中文原因。
 * @param {string} toolName - 被拒绝的工具名。
 * @returns {string} 拒绝原因。
 */
export function denyReason(toolName) {
  return (
    `report-mode: host 级 ${toolName} 在本模式已禁用（GitHub 操作与报表/取数无关，` +
    '且本模式无 shell、无发布职责）。需要 GitHub 操作请在普通模式会话中进行，不要尝试绕道。'
  )
}

/**
 * 对当前 agent scope 施加工具屏蔽：restrict（隐藏 schema，best-effort）+
 * guard（前缀 `gh_` 调用时拒绝，强制层）+ 固定窗重试。
 * @param {any} ctx - 预设内的 agent scope 上下文（必须 scoped，否则 restrict 会抛）。
 * @returns {{ restricted: boolean, guarded: boolean }} 两层是否安装成功（供测试断言）。
 */
export function apply(ctx) {
  const restricted = restrictBestEffort(ctx, HOST_GITHUB_OPS_TOOLS, 'host github-ops 工具')
  const guarded = installGuard(
    ctx,
    (execution) => {
      const toolName = normalizeToolName(execution)
      if (!toolName.startsWith(HOST_GITHUB_OPS_PREFIX)) return undefined
      return denyReason(toolName)
    },
    'host github-ops 工具',
  )
  scheduleRestrictRetry(ctx, HOST_GITHUB_OPS_TOOLS, 'host github-ops 工具')
  return { restricted, guarded }
}
