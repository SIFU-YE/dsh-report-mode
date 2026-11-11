/**
 * report-mode 的 host 团队工具裁剪 —— 预设内 scoped 行（0.1.31 新增）。
 *
 * 为什么不启用团队：报表模式的 persona 是单人报表工程师（分析需求 → 取数 → 实现 → 审查 →
 * 交付），团队协作（建团/队长/成员/任务领取）会引入另一套未验证的 prompt 与状态机，且
 * 0.1.23 起已从预设里移除 `@nanmicoder/dsh-agent-teams`。但 profile 仍可能装着
 * experimental-agent-team-profile（host 级），于是 `spawn_teammate` / `team_task_*` /
 * `wait_agent` 等团队工具对报表模式**可见但被 persona 禁止**——正是 0.1.30 复审里
 * "可见但被规则禁止"的一类。本行把它们在报表模式里 deny 掉：
 *   · restrict() 隐藏 schema（best-effort，team 工具若异步注册则可能失败）；
 *   · guard() 在调用时拒绝（强制，与注册时序无关；注册在预设 scoped context，只作用于
 *     报表模式 agent，不影响其他预设的团队会话）。
 *
 * 保留：`list_agents`（看子代理列表）、`send_message`（给子代理追加指令）、
 * `interrupt_agent`（硬停跑偏的子代理）——persona 的「子代理复用与共享清单」协议依赖它们；
 * `wait_agent` 属团队等待语义，报表模式用 `send_message` 续聊即可，不需要等待通道。
 * 两层都 fail-open：异常只告警，绝不让报表模式启动失败。
 * @module dsh-report-mode/restrict-host-team
 */

import { installDenyGuard } from './host-tool-guard.mjs'

/** 本行在 Cordis 组合里的插件名。 */
export const name = 'report-mode-restrict-host-team'

/** 依赖的工具注册表。 */
export const inject = ['tools']

/**
 * 需要从报表模式屏蔽的 host 团队工具名。
 * 与 `@deepseek-ai/dsh-experimental-agent-team-profile` 注册的工具对应；改上游名字时这里也要改。
 * 刻意保留 list_agents / send_message / interrupt_agent（见文件头）。
 */
export const HOST_TEAM_TOOLS = Object.freeze([
  'spawn_teammate',
  'wait_agent',
  'team_task_create',
  'team_task_get',
  'team_task_list',
  'team_task_update',
])

/**
 * 被 guard 拒绝时返回给模型的中文原因。
 * @param {string} toolName - 被拒绝的工具名。
 * @returns {string} 拒绝原因。
 */
export function denyReason(toolName) {
  return (
    `report-mode: 团队协作工具 ${toolName} 在本模式不可用（本模式不启用团队协作）。` +
    '需要并行子任务时请用 subagent + list_agents / send_message / interrupt_agent 的「子代理委派 + 共享清单」协议，' +
    '不要尝试绕道。'
  )
}

/**
 * 对当前 agent scope 施加团队工具屏蔽：restrict 隐藏 schema（best-effort）+ guard 调用时拒绝（强制）。
 * @param {any} ctx - 预设内的 agent scope 上下文（必须 scoped，否则 restrict 会抛）。
 * @returns {{ restricted: boolean, guarded: boolean }} 两层是否安装成功（供测试断言）。
 */
export function apply(ctx) {
  return installDenyGuard(ctx, {
    deny: HOST_TEAM_TOOLS,
    reason: denyReason,
    label: 'host 团队工具',
  })
}
