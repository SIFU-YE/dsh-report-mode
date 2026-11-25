/**
 * report-mode 的浏览器 URL 护栏 —— 预设内 scoped 行（0.1.31 新增）。
 *
 * 为什么需要：persona 写着"只允许打开本地预览页，禁止公网浏览"，但纯文字约束挡不住
 * chrome-devtools-mcp 的 navigate_page / new_page。本模式刻意没有 shell、没有公网访问能力，
 * 浏览器是唯一对外通道，必须在工具层强制。
 *
 * 两层防线（0.1.31 收口）：
 *   1. 本模块（工具层 guard）：在 `navigate_page` / `new_page` 调用时校验 URL；
 *   2. mcp-browser 的 `--allowedUrlPattern`（浏览器网络层，Chrome 149+）：拦子资源、重定向、
 *      evaluate_script 内的 fetch / WebSocket / location.href。本模块的白名单与它**保持一致**：
 *      localhost / 127.0.0.1 / *.localhost / about:blank，**不含 IPv6**——URLPattern 不支持
 *      `[::1]` 作为 pattern（实测 Invalid URLPattern），若 guard 放行 [::1] 就会出现
 *      "guard 放行但浏览器网络层拒绝"的矛盾，故两边都不列 IPv6。
 *
 * 语义：
 *   · `mcp__browser__navigate_page`：只在 `type` 为 `url`（或给了 url、type 缺省的旧形状）时
 *     校验 `url`；`back` / `forward` / `reload` 等无 URL 动作放行；
 *   · `mcp__browser__new_page`：校验 `url`（缺省 url 时 new_page 只会开空白页，放行）；
 *   · 白名单：hostname 为 `localhost` / `127.0.0.1` / `*.localhost`（`http:` / `https:`），或整串
 *     恰为 `about:blank`；端口不限（FineReport 预览端口随机）；
 *   · 其余一律拒绝，返回中文原因（含被拒 URL 的前 120 字符，便于排查）。
 *
 * 只用 guard（调用时拒绝），不做 restrict：这些工具要留在 schema 里（本地预览是正常流程），
 * 只拦非本地 URL。guard 注册在预设 scoped context → 只作用于报表模式 agent。
 * fail-open：guard 不可用或判断异常时只告警，不阻断启动。
 * @module dsh-report-mode/guard-browser-local
 */

import {
  installGuard,
  normalizeToolArguments,
  normalizeToolName,
} from './host-tool-guard.mjs'

/** 本行在 Cordis 组合里的插件名。 */
export const name = 'report-mode-guard-browser-local'

/** 依赖的工具注册表（guard 属于 tools 服务）。 */
export const inject = ['tools']

/** 需要校验 URL 的浏览器工具名（与 chrome-devtools-mcp 的工具名对应）。 */
export const BROWSER_URL_TOOLS = Object.freeze([
  'mcp__browser__navigate_page',
  'mcp__browser__new_page',
])

/**
 * 允许的 hostname（不含 IPv6：URLPattern 不支持 [::1]，浏览器网络层会拒绝，guard 侧保持一致）。
 * `*.localhost` 由后缀判断，见 `isAllowedBrowserHostname`。
 */
const ALLOWED_HOSTNAMES = new Set(['localhost', '127.0.0.1'])

/**
 * 判断 hostname 是否属于本地预览白名单（localhost / 127.0.0.1 / *.localhost）。
 * @param {string} hostname - 已小写、去方括号/尾点的 hostname。
 * @returns {boolean} 是否允许。
 */
export function isAllowedBrowserHostname(hostname) {
  if (ALLOWED_HOSTNAMES.has(hostname)) return true
  return hostname.endsWith('.localhost')
}

/**
 * 判断一个 URL 是否允许在本模式打开。
 * @param {unknown} raw - 待校验的 URL（非字符串一律拒绝）。
 * @returns {boolean} true = 本地预览/空白页，允许；false = 拒绝。
 */
export function isAllowedBrowserUrl(raw) {
  if (typeof raw !== 'string') return false
  const value = raw.trim()
  if (value === '') return false
  if (value.toLowerCase() === 'about:blank') return true
  let url
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  return isAllowedBrowserHostname(hostname)
}

/**
 * 生成拒绝原因（截断 URL，避免把超长串塞进模型上下文）。
 * @param {string} toolName - 被拒绝的工具名。
 * @param {unknown} rawUrl - 原始 URL。
 * @returns {string} 中文原因。
 */
export function denyReason(toolName, rawUrl) {
  const shown = String(rawUrl ?? '').slice(0, 120)
  return (
    `report-mode: ${toolName} 只允许打开本地预览页（localhost / 127.0.0.1 / *.localhost / about:blank），` +
    `已拒绝 ${shown}。本模式没有公网访问能力（浏览器网络层也只放行本地来源）；` +
    `需要抓取公网资料时请告知用户并切到通用模式。`
  )
}

/**
 * guard 回调：检查浏览器工具调用的 URL。不是这两个工具时不拦截。
 * @param {unknown} execution - `ToolExecution`（含 name 与 arguments）。
 * @returns {string | undefined} 拒绝原因；undefined 表示放行。
 */
export function checkBrowserCall(execution) {
  const toolName = normalizeToolName(execution)
  if (!BROWSER_URL_TOOLS.includes(toolName)) return undefined
  const args = normalizeToolArguments(execution)
  const rawUrl = args.url
  const hasUrl = typeof rawUrl === 'string' && rawUrl.trim() !== ''
  // 没有 URL 的调用（new_page 开空白页 / navigate_page 的 back-forward-reload）放行：
  // 它们不会把页面导航到公网地址。navigate_page 明确 type != url 时同理。
  if (!hasUrl) return undefined
  if (toolName === 'mcp__browser__navigate_page') {
    const type = typeof args.type === 'string' ? args.type.toLowerCase() : ''
    if (type !== '' && type !== 'url') return undefined
  }
  if (isAllowedBrowserUrl(rawUrl)) return undefined
  return denyReason(toolName, rawUrl)
}

/**
 * 安装浏览器 URL guard（只有一层：guard；工具 schema 保持可见）。
 * @param {any} ctx - 预设内的 agent scope 上下文。
 * @returns {boolean} 是否成功注册 guard。
 */
export function apply(ctx) {
  return installGuard(ctx, checkBrowserCall, 'browser 公网访问')
}
