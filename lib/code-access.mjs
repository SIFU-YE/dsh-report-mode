/**
 * 报表模式「按需代码执行」租约（预设内 scoped 行）。
 *
 * 为什么需要：
 *   报表模式的默认红线是「无 shell、无公网」。但真实工作里会遇到只有计算才能完成的任务
 *   ——例如把几百行 Excel 解析成可一键导入的 SQL、批量生成脚本、核对大表口径。此前这类
 *   任务只能退化成「给用户一段本地脚本自己跑」，模型无法真正完成。本行提供一个**按需**
 *   的代码执行通道：常态不注册执行工具，用户明确同意后申请短时租约，用完即释放。
 *
 * 为什么内置在预设行里、而不是装 host 级插件：
 *   与 `delete-file` 同理——`ctx.tools.register` 在预设内的 scoped context 调用时注册为
 *   scoped 工具，只有报表模式的 agent 能看到；host 级插件注册的工具对所有预设可见，
 *   会把代码执行能力泄漏给其他模式。本文件按 `<包名>/code-access` 导出（见 package.json
 *   exports），由预设 plugins 列表以 `- id: code-access / name: dsh-report-mode/code-access`
 *   一行挂载。
 *
 * 两段式语义（「常态不开启，申请后开启」）：
 *   1. 常驻只有 `request_code_access` / `release_code_access` 两个无危险工具；
 *   2. `request_code_access` 校验 `confirm=true` 后授予 TTL 租约（默认 10 分钟，上限 30），
 *      并在同一 scoped 注册表里**动态注册** `run_script`；租约到期或 `release_code_access`
 *      调用时立即注销 —— 工具从 tools/list 消失。
 *
 * 安全语义见 `code-access-core.mjs`（租约状态机、环境清洗、凭据文件护栏、资源上限）。
 * 临时脚本写在系统临时目录、cwd 指向会话工作区，执行后立即删除。
 *
 * @module dsh-report-mode/code-access
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  DEFAULT_TIMEOUT_MS, MAX_CODE_BYTES, MAX_TIMEOUT_MS, LeaseStore,
  buildEnv, clampTimeoutMs, clampTtlMinutes, deniedReason,
  resolveInterpreter, runProcess, sessionKeyOf, workspaceOf,
} from './code-access-core.mjs'

/** 本行在 Cordis 组合里的插件名。 */
export const name = 'dsh-report-mode-code-access'

/** 依赖的工具注册表。 */
export const inject = ['tools']

/** 工具名（测试与提示文案共用，避免字符串散落）。 */
export const TOOL_NAMES = Object.freeze({
  request: 'request_code_access',
  run: 'run_script',
  release: 'release_code_access',
})

const REGISTER_LABEL = {
  run: 'dsh-report-mode: run_script (lease-gated)',
}

/** 批处理工具定义：run_script（只在租约有效期内注册）。 */
function makeRunTool(leases) {
  return defineTool({
    name: TOOL_NAMES.run,
    description: 'Run a short local script (node or python) and return its stdout/stderr/exit code. Requires an active code-execution lease from request_code_access; call release_code_access when done. Runs with cwd = session workspace, a scrubbed environment (no harness/MCP credentials), env proxies pointed at an unreachable port, a timeout (default 30s, max 120s) and capped output. Code that references credential files (.env, instance keys, ssh/cloud configs) is refused. Use it for local computation only — e.g. parse a local workbook and emit SQL.',
    parameters: {
      language: { type: 'string', required: true, description: "Interpreter: 'python' or 'node'." },
      code: { type: 'string', required: true, description: 'Script source (<=200KB). Runs from a temporary file; cwd is the session workspace, so workspace-relative paths work.' },
      purpose: { type: 'string', description: 'One-line reason for this run (audit trail; optional).' },
      timeout_ms: { type: 'number', description: `Timeout in ms (default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}).` },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          exitCode: { type: 'number' },
          timedOut: { type: 'boolean', required: true },
          durationMs: { type: 'number', required: true },
          stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
          language: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.language} exit=${value.exitCode} ${value.durationMs}ms${value.timedOut ? ' TIMEOUT' : ''}\n--- stdout ---\n${value.stdout}${value.stderr ? `\n--- stderr ---\n${value.stderr}` : ''}`,
      }],
    },
    async execute(args, exec) {
      const key = sessionKeyOf(exec)
      const lease = leases.get(key)
      if (!lease) {
        throw new Error(`${TOOL_NAMES.run}: 没有有效的代码执行租约——先调用 ${TOOL_NAMES.request} 并取得用户同意，或租约已过期/已释放`)
      }
      const language = String(args?.language ?? '').trim().toLowerCase()
      if (language !== 'python' && language !== 'node') {
        throw new Error(`${TOOL_NAMES.run}: language 只能是 'python' 或 'node'`)
      }
      const code = String(args?.code ?? '')
      if (code.trim() === '') throw new Error(`${TOOL_NAMES.run}: code 不能为空`)
      if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
        throw new Error(`${TOOL_NAMES.run}: code 超过 ${MAX_CODE_BYTES}B 上限，请改为把数据放进工作区文件、脚本里读文件`)
      }
      const hit = deniedReason(code)
      if (hit !== null) {
        throw new Error(`${TOOL_NAMES.run}: 代码引用了受保护的凭据路径（${hit}），拒绝执行`)
      }
      const interpreter = resolveInterpreter(language)
      if (!interpreter) {
        throw new Error(`${TOOL_NAMES.run}: 找不到可用的 ${language} 解释器（PATH 里没有 python；node 用宿主自带可执行文件）`)
      }
      const cwd = workspaceOf(exec)
      const timeoutMs = clampTimeoutMs(args?.timeout_ms)
      const dir = await mkdtemp(join(tmpdir(), 'dsh-code-'))
      const file = join(dir, language === 'python' ? 'main.py' : 'main.mjs')
      try {
        await writeFile(file, code, 'utf8')
        const result = await runProcess(interpreter.cmd, [...interpreter.pre, file], {
          cwd, env: buildEnv(), timeoutMs,
        })
        return { ...result, language }
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  })
}

export function apply(ctx) {
  const leases = new LeaseStore()
  /** @type {Map<string, ReturnType<typeof setTimeout>>} 租约到期兜底定时器 */
  const timers = new Map()
  /** @type {null | (() => void)} 动态注册的 run_script disposer */
  let disposeRun = null

  const dropRunTool = () => {
    if (disposeRun) {
      try { disposeRun() } catch { /* 已被上层卸载 */ }
      disposeRun = null
    }
  }

  const ensureRunTool = () => {
    if (disposeRun) return
    let dispose
    try {
      dispose = ctx.tools.register(makeRunTool(leases), REGISTER_LABEL.run)
    } catch (error) {
      throw new Error(`${TOOL_NAMES.request}: 动态注册 ${TOOL_NAMES.run} 失败（${error?.message ?? error}）`)
    }
    disposeRun = typeof dispose === 'function' ? dispose : () => {}
  }

  const clearTimer = (key) => {
    const timer = timers.get(key)
    if (timer !== undefined) {
      clearTimeout(timer)
      timers.delete(key)
    }
  }

  const armTimer = (key, ttlMs) => {
    clearTimer(key)
    const timer = setTimeout(() => {
      timers.delete(key)
      leases.revoke(key)
      dropRunTool()
    }, ttlMs)
    if (typeof timer.unref === 'function') timer.unref()
    timers.set(key, timer)
  }

  const requestTool = defineTool({
    name: TOOL_NAMES.request,
    description: `Request a time-limited code-execution lease for this session. Code execution is OFF by default in report mode. Only call this after the user explicitly agreed in the conversation, and pass confirm=true; otherwise the call is rejected. On success a ${TOOL_NAMES.run} tool becomes available until release or expiry (default 10 minutes, max 30). The lease grants no credentials and no network: the child process gets a scrubbed environment and proxy variables pointing at an unreachable port. Typical use: parse a local workbook / large file and emit a script or SQL.`,
    parameters: {
      reason: { type: 'string', required: true, description: 'Why code execution is needed (shown in the lease; at least 3 characters).' },
      confirm: { type: 'boolean', required: true, description: 'Must be true — confirms the user explicitly agreed to run code in this session.' },
      ttl_minutes: { type: 'number', description: 'Lease lifetime in minutes (default 10, max 30).' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          granted: { type: 'boolean', required: true },
          reused: { type: 'boolean', required: true },
          expiresInSeconds: { type: 'number', required: true },
          workspace: { type: 'string', required: true },
          runTool: { type: 'string', required: true },
          note: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `代码执行租约已开通（${value.expiresInSeconds}s，workspace=${value.workspace}）。可用工具：${value.runTool}。${value.note}`,
      }],
    },
    async execute(args, exec) {
      const reason = String(args?.reason ?? '').trim()
      if (reason.length < 3) {
        throw new Error(`${TOOL_NAMES.request}: 请说明为什么需要代码执行（reason 至少 3 个字符）`)
      }
      if (args?.confirm !== true) {
        throw new Error(`${TOOL_NAMES.request}: 需要先在对话里取得用户明确同意，再传 confirm=true 调用——本工具不会自行开通`)
      }
      const key = sessionKeyOf(exec)
      const workspace = workspaceOf(exec)
      const ttlMinutes = clampTtlMinutes(args?.ttl_minutes)
      const ttlMs = ttlMinutes * 60_000
      const reused = leases.get(key) !== null
      leases.grant(key, ttlMs, { reason, workspace })
      ensureRunTool()
      armTimer(key, ttlMs)
      return {
        granted: true,
        reused,
        expiresInSeconds: Math.round(ttlMs / 1000),
        workspace: String(workspace),
        runTool: TOOL_NAMES.run,
        note: `用完立即调用 ${TOOL_NAMES.release} 释放；到期自动注销。执行环境无凭据、无网络、输出有上限。`,
      }
    },
  })

  const releaseTool = defineTool({
    name: TOOL_NAMES.release,
    description: `Release the code-execution lease for this session immediately and remove the ${TOOL_NAMES.run} tool. Call it as soon as the computation is done; an unused lease still expires on its own.`,
    // 无参数工具也必须给出 parameters: {}。宿主对空参数工具同样走
    // parameterSchemaSpecToJsonSchema(parameters)，缺省会抛
    // "parameters must be an object of value schemas" 并让整行 never started
    // （2026-11-23 线上事故：本行漏了这一行，report 会话起不来）。
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          released: { type: 'boolean', required: true },
          note: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `代码执行租约已释放（${value.note}）` }],
    },
    async execute(_args, exec) {
      const key = sessionKeyOf(exec)
      const released = leases.revoke(key)
      clearTimer(key)
      dropRunTool()
      return { released, note: released ? '工具已注销' : '本会话没有有效租约' }
    },
  })

  ctx.tools.register(requestTool, 'dsh-report-mode: request_code_access')
  ctx.tools.register(releaseTool, 'dsh-report-mode: release_code_access')

  // 插件卸载时清干净：注销动态工具、清定时器与租约（Cordis 若忽略返回值也无副作用）。
  return () => {
    for (const key of [...timers.keys()]) clearTimer(key)
    leases.clear()
    dropRunTool()
  }
}
