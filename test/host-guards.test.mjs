/**
 * 预设内工具护栏的 fake ctx 单测（0.1.31）。
 *
 * 目的：把「restrict 只是 schema 隐藏 best-effort、guard 才是调用时强制层」这个结论
 * 固化成可回归的测试 —— 尤其覆盖 0.1.30 的实测缺陷：MCP 工具异步注册时 restrict 抛
 * "unknown name"，旧实现直接 fail-open，工具仍可调用。
 *
 * 用 `node --test test/host-guards.test.mjs` 运行（已接入 npm test）。
 * 不启动真实 Host、不读写工作区外文件。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import * as team from '../lib/restrict-host-team.mjs'
import * as toolbox from '../lib/restrict-host-toolbox.mjs'
import * as git from '../lib/restrict-host-git.mjs'
import * as browser from '../lib/guard-browser-local.mjs'
import {
  normalizeToolArguments,
  normalizeToolName,
} from '../lib/host-tool-guard.mjs'

/**
 * 构造 fake Cordis ctx：记录 restrict/guard 调用，可模拟各种失败。
 * @param {object} [options]
 * @param {boolean} [options.restrictThrows] - 模拟 "unknown names"（MCP 工具尚未注册）。
 * @param {boolean} [options.guardThrows] - 模拟 guard 注册失败。
 * @param {boolean} [options.noRestrict] - 模拟工具服务没有 restrict 方法。
 * @param {boolean} [options.noGuard] - 模拟旧版工具服务没有 guard 方法。
 * @returns {{ ctx: any, restrictions: any[], guards: Function[], warnings: string[] }}
 */
function fakeCtx(options = {}) {
  const {
    restrictThrows = false,
    guardThrows = false,
    noRestrict = false,
    noGuard = false,
  } = options
  const restrictions = []
  const guards = []
  const warnings = []
  const ctx = {
    tools: {},
    logger: {
      warn(message) {
        warnings.push(String(message))
      },
    },
  }
  if (!noRestrict) {
    ctx.tools.restrict = (filter) => {
      if (restrictThrows) throw new Error('unknown tool name: mcp__toolbox__doris_query')
      restrictions.push(filter)
      return () => {}
    }
  }
  if (!noGuard) {
    ctx.tools.guard = (guard) => {
      if (guardThrows) throw new Error('guard registration failed')
      guards.push(guard)
      return () => {}
    }
  }
  return { ctx, restrictions, guards, warnings }
}

/**
 * 断言某个 guard 拒绝指定工具名（且原因包含期望片段）。
 * @param {Function[]} guards - fakeCtx 收集到的 guard 回调。
 * @param {string} toolName - 工具名。
 * @param {string} reasonSnippet - 期望出现在拒绝原因里的片段。
 */
function assertDenied(guards, toolName, reasonSnippet) {
  assert.equal(guards.length, 1, '应恰好注册一个 guard')
  const reason = guards[0]({ name: toolName, arguments: {} })
  assert.equal(typeof reason, 'string', `${toolName} 应被拒绝`)
  assert.ok(reason.includes(reasonSnippet), `拒绝原因应包含 ${reasonSnippet}，实际：${reason}`)
}

/**
 * 断言某个 guard 放行指定工具名。
 * @param {Function[]} guards - fakeCtx 收集到的 guard 回调。
 * @param {string} toolName - 工具名。
 */
function assertAllowed(guards, toolName) {
  assert.equal(guards[0]({ name: toolName, arguments: {} }), undefined, `${toolName} 应放行`)
}

test('restrict-host-team：deny 6 个团队工具、保留 3 个子代理控制工具', () => {
  const { ctx, restrictions, guards } = fakeCtx()
  const result = team.apply(ctx)
  assert.deepEqual(result, { restricted: true, guarded: true })
  assert.deepEqual(restrictions[0].deny, [...team.HOST_TEAM_TOOLS])
  for (const toolName of team.HOST_TEAM_TOOLS) {
    assertDenied(guards, toolName, '团队协作工具')
  }
  for (const toolName of ['list_agents', 'send_message', 'interrupt_agent']) {
    assertAllowed(guards, toolName)
  }
  assertAllowed(guards, 'read')
  assertAllowed(guards, 'mcp__cpt-mcp__read_cpt')
})

test('restrict-host-team：guard 与注册时序无关——restrict 失败仍会拒绝调用', () => {
  const { ctx, guards, warnings } = fakeCtx({ restrictThrows: true })
  const result = team.apply(ctx)
  assert.deepEqual(result, { restricted: false, guarded: true })
  assert.ok(warnings.some((line) => line.includes('restrict')), 'restrict 失败应有告警')
  assertDenied(guards, 'spawn_teammate', '本模式不可用')
  assertAllowed(guards, 'list_agents')
})

test('restrict-host-toolbox：deny 3 个 host toolbox 工具、不误伤 doris/mysql/testdb', () => {
  const { ctx, restrictions, guards } = fakeCtx()
  const result = toolbox.apply(ctx)
  assert.deepEqual(result, { restricted: true, guarded: true })
  assert.deepEqual(restrictions[0].deny, [...toolbox.HOST_TOOLBOX_TOOLS])
  for (const toolName of toolbox.HOST_TOOLBOX_TOOLS) {
    assertDenied(guards, toolName, 'host 级')
  }
  for (const toolName of [
    'mcp__doris__execute_query',
    'mcp__mysql__list_tables',
    'mcp__testdb__describe_table',
  ]) {
    assertAllowed(guards, toolName)
  }
})

test('restrict-host-git：deny 6 个旧 report-git 推送/远端工具、保留内置本地 git', () => {
  const { ctx, restrictions, guards } = fakeCtx()
  const result = git.apply(ctx)
  assert.deepEqual(result, { restricted: true, guarded: true })
  assert.deepEqual(restrictions[0].deny, [...git.REPORT_GIT_TOOLS])
  for (const toolName of git.REPORT_GIT_TOOLS) {
    assertDenied(guards, toolName, '已禁用')
  }
  for (const toolName of [
    'git_init',
    'git_status',
    'git_diff',
    'git_log',
    'git_commit',
    'git_branch',
  ]) {
    assertAllowed(guards, toolName)
  }
})

test('护栏在 tools.guard 缺失/注册失败时不抛错，只告警（fail-open）', () => {
  const noGuardCtx = fakeCtx({ noGuard: true })
  const noGuardResult = team.apply(noGuardCtx.ctx)
  assert.deepEqual(noGuardResult, { restricted: true, guarded: false })
  assert.ok(noGuardCtx.warnings.some((line) => line.includes('tools.guard')))

  const throwingCtx = fakeCtx({ guardThrows: true })
  const throwingResult = toolbox.apply(throwingCtx.ctx)
  assert.deepEqual(throwingResult, { restricted: true, guarded: false })
  assert.ok(throwingCtx.warnings.length > 0)
})

test('guard 参数形状防御：name/toolName/tool.name 与异常输入', () => {
  assert.equal(normalizeToolName({ name: 'a' }), 'a')
  assert.equal(normalizeToolName({ toolName: 'b' }), 'b')
  assert.equal(normalizeToolName({ tool: { name: 'c' } }), 'c')
  assert.equal(normalizeToolName({ call: { name: 'd' } }), 'd')
  assert.equal(normalizeToolName({}), '')
  assert.equal(normalizeToolName(null), '')
  assert.equal(normalizeToolName(undefined), '')

  assert.deepEqual(normalizeToolArguments({ arguments: { x: 1 } }), { x: 1 })
  assert.deepEqual(normalizeToolArguments({ args: { x: 2 } }), { x: 2 })
  assert.deepEqual(normalizeToolArguments({ input: { x: 3 } }), { x: 3 })
  assert.deepEqual(normalizeToolArguments(undefined), {})

  const { ctx, guards } = fakeCtx()
  team.apply(ctx)
  assert.equal(typeof guards[0]({ toolName: 'team_task_get', args: {} }), 'string')
  assert.equal(typeof guards[0]({ tool: { name: 'spawn_teammate' } }), 'string')
  assert.equal(guards[0](null), undefined)
  assert.equal(guards[0]({}), undefined)
})

test('guard-browser-local：只允许 localhost / 127.0.0.1 / *.localhost / about:blank（不含 IPv6）', () => {
  const allowed = [
    'http://localhost:8080/page',
    'https://localhost/',
    'http://127.0.0.1:8075/decision/v10/entry/access/abc',
    'http://preview.localhost:3000/',
    'https://app.localhost/decision/v10',
    'http://LOCALHOST:3000/',
    'about:blank',
  ]
  const denied = [
    'http://example.com/',
    'https://evil.example.org/path',
    'http://127.0.0.1.example.com/',
    'http://evil.localhost.example.com/',
    // IPv6 不在白名单：URLPattern 不支持 [::1]，浏览器网络层会拒绝；guard 必须与之一致。
    'http://[::1]:8080/',
    'https://[::1]/',
    'ftp://127.0.0.1/',
    'file:///tmp/x.ini',
    'javascript:alert(1)',
    'about:config',
    'not-a-url',
    '',
  ]
  for (const url of allowed) {
    assert.equal(browser.isAllowedBrowserUrl(url), true, `应允许 ${url}`)
  }
  for (const url of denied) {
    assert.equal(browser.isAllowedBrowserUrl(url), false, `应拒绝 ${url}`)
  }
  // hostname 白名单本身也验证一遍（与 --allowedUrlPattern 的 pattern 对齐）
  assert.equal(browser.isAllowedBrowserHostname('localhost'), true)
  assert.equal(browser.isAllowedBrowserHostname('127.0.0.1'), true)
  assert.equal(browser.isAllowedBrowserHostname('preview.localhost'), true)
  assert.equal(browser.isAllowedBrowserHostname('::1'), false)
  assert.equal(browser.isAllowedBrowserHostname('localhost.example.com'), false)
})

test('guard-browser-local：navigate_page / new_page 的 URL 校验与放行规则', () => {
  const { ctx, restrictions, guards } = fakeCtx()
  const result = browser.apply(ctx)
  assert.equal(result, true)
  assert.equal(restrictions.length, 0, '浏览器护栏只注册 guard，不做 restrict')
  assert.equal(guards.length, 1)

  const check = (toolName, args) => guards[0]({ name: toolName, arguments: args })

  // 本地 URL 放行
  assert.equal(check('mcp__browser__navigate_page', { type: 'url', url: 'http://127.0.0.1:8080/a' }), undefined)
  assert.equal(check('mcp__browser__new_page', { url: 'http://localhost:3000/' }), undefined)
  assert.equal(check('mcp__browser__navigate_page', { type: 'url', url: 'http://preview.localhost:8080/x' }), undefined)
  // 无 URL 的导航动作放行（back / forward / reload / 空白页）
  assert.equal(check('mcp__browser__navigate_page', { type: 'back' }), undefined)
  assert.equal(check('mcp__browser__navigate_page', { type: 'reload' }), undefined)
  assert.equal(check('mcp__browser__new_page', {}), undefined)
  // 公网 URL 拒绝
  const deniedNav = check('mcp__browser__navigate_page', { type: 'url', url: 'https://example.com/' })
  assert.equal(typeof deniedNav, 'string')
  assert.ok(deniedNav.includes('只允许打开本地预览页'))
  assert.ok(deniedNav.includes('https://example.com/'))
  const deniedNew = check('mcp__browser__new_page', { url: 'http://example.com/' })
  assert.equal(typeof deniedNew, 'string')
  // IPv6 不在白名单（与 --allowedUrlPattern 对齐；URLPattern 不支持 [::1]）
  assert.equal(typeof check('mcp__browser__new_page', { url: 'http://[::1]:8080/' }), 'string')
  // 缺省 type 但带 url 的旧形状同样校验（防御）
  assert.equal(typeof check('mcp__browser__navigate_page', { url: 'https://example.com/' }), 'string')
  // 其他浏览器工具不拦截（只限制这两个）
  assert.equal(check('mcp__browser__evaluate_script', { url: 'https://example.com/' }), undefined)
  // 非字符串 url 形状异常 → fail-open（不误杀）
  assert.equal(check('mcp__browser__new_page', { url: 123 }), undefined)
})
