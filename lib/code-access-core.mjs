/**
 * 报表模式「按需代码执行」的核心逻辑（**无宿主依赖**，可被 node --test 直接单测）。
 *
 * 为什么把逻辑拆到这里：
 *   `code-access.mjs` 需要 import '@deepseek-ai/dsh-tools' 才能 defineTool，而该包在
 *   仓库内不可解析（由宿主提供）。把租约状态机、环境清洗、脚本执行等纯逻辑放在本文件，
 *   仓库测试即可在不启动宿主的前提下覆盖安全语义；行模块只做 schema 与接线。
 *
 * 安全模型（与 persona「代码执行默认关闭」一致，四层）：
 *   1. 租约：没有有效租约就不执行（状态机显式 grant/revoke/TTL 过期）；
 *   2. 环境清洗：只透传运行时白名单变量，绝不透传 harness/MCP 凭据（黑名单兜底）；
 *      并注入指向不可达端口的代理变量做「尽力」网络阻断（不当作强安全边界）；
 *   3. 凭据文件护栏：代码文本命中 .env / 实例键 / ssh/云配置等特征即拒绝；
 *   4. 资源上限：代码体积、超时、输出体积都有上限，临时目录用后即删。
 * @module dsh-report-mode/code-access-core
 */
import { spawn } from 'node:child_process'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

/** 代码体积上限（避免把整份大文件塞进参数）。 */
export const MAX_CODE_BYTES = 200_000
/** 单路输出上限（字符）。 */
export const MAX_OUTPUT_CHARS = 30_000
/** 超时默认值与上限（毫秒）。 */
export const DEFAULT_TIMEOUT_MS = 30_000
export const MAX_TIMEOUT_MS = 120_000
/** 租约默认与最长 TTL（分钟）。 */
export const DEFAULT_TTL_MIN = 10
export const MAX_TTL_MIN = 30
/** 「尽力」网络阻断时指向的不可达地址（端口 9 = discard）。 */
export const BLOCKED_PROXY = 'http://127.0.0.1:9'

/**
 * 允许透传给子进程的环境变量（小写比较，Windows 大小写不敏感）。
 * 只保留让解释器正常启动所需的最小集合——刻意不含任何 DSH_/MCP/业务变量。
 */
const ENV_ALLOW = new Set([
  'path', 'pathext', 'systemroot', 'windir', 'comspec', 'temp', 'tmp', 'tmpdir',
  'userprofile', 'homedrive', 'homepath', 'appdata', 'localappdata',
  'number_of_processors', 'processor_architecture', 'os', 'lang', 'lc_all',
  'programfiles', 'programdata', 'programfiles(x86)', 'programw6432',
  'commonprogramfiles', 'commonprogramfiles(x86)', 'public', 'allusersprofile',
])

/** 凭据类变量名特征：即使误入白名单也绝不透传。 */
const SECRET_NAME = /(key|token|secret|passw?d|credential|dsn|conn|auth|litellm|report_|cpt_|openviking|ov_)/i

/**
 * 明显引用凭据文件的代码特征：命中即拒绝执行。
 *
 * `.env` / `.ssh` 这类以点开头的名字必须用「非单词字符边界」判据，否则
 * `os.environ` 会因包含子串 ".env" 被误判（2026-11-23 单测暴露）。
 */
export const DENY_PATTERNS = Object.freeze([
  { label: '.env', re: /(^|[^\w])\.env\b/ },
  { label: '.ssh', re: /(^|[^\w])\.ssh\b/ },
  { label: '.aws', re: /(^|[^\w])\.aws\b/ },
  { label: '.azure', re: /(^|[^\w])\.azure\b/ },
  { label: '.gcp', re: /(^|[^\w])\.gcp\b/ },
  { label: 'id_rsa', re: /\bid_rsa\b/ },
  { label: 'id_ed25519', re: /\bid_ed25519\b/ },
  { label: 'credentials', re: /credentials/i },
  { label: 'instance-keys', re: /instance-keys/i },
  { label: 'auth.json', re: /\bauth\.json\b/i },
  { label: 'openviking', re: /openviking/i },
  { label: 'private_key', re: /\bprivate[_-]?key\b/i },
  { label: 'kubeconfig', re: /\bkubeconfig\b/i },
])

/**
 * 构造子进程环境：白名单透传 + 注入编码/阻断变量。
 * @param {Record<string, string|undefined>} [base] 源环境（测试注入用，默认 process.env）
 * @returns {Record<string, string>}
 */
export function buildEnv(base = process.env) {
  const env = {}
  for (const [name, value] of Object.entries(base)) {
    if (typeof value !== 'string') continue
    const lower = name.toLowerCase()
    if (!ENV_ALLOW.has(lower)) continue
    if (SECRET_NAME.test(lower)) continue
    env[name] = value
  }
  env.PYTHONIOENCODING = 'utf-8'
  env.PYTHONUTF8 = '1'
  env.DSH_CODE_ACCESS = '1'
  // 「尽力」网络阻断：不保证拦得住不看代理变量的客户端，真正的边界是「无凭据 + 用户同意」。
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    env[key] = BLOCKED_PROXY
  }
  env.NO_PROXY = ''
  env.no_proxy = ''
  return env
}

/**
 * 代码是否引用了受保护的凭据路径。
 * @param {string} code
 * @returns {string|null} 命中的特征（拒绝理由用），未命中返回 null
 */
export function deniedReason(code) {
  const text = String(code ?? '')
  for (const { label, re } of DENY_PATTERNS) {
    if (re.test(text)) return label
  }
  return null
}

/** 把 TTL 分钟夹到 [1, MAX_TTL_MIN]。 */
export function clampTtlMinutes(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TTL_MIN
  return Math.min(MAX_TTL_MIN, Math.max(1, Math.round(n)))
}

/** 把超时夹到 [1s, MAX_TIMEOUT_MS]。 */
export function clampTimeoutMs(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(1_000, Math.round(n)))
}

/**
 * 租约状态机（按会话键隔离）。显式 TTL：读取时惰性过期，另由调用方挂定时器兜底注销。
 */
export class LeaseStore {
  /** @param {() => number} [clock] 时钟（测试可注入） */
  constructor(clock = () => Date.now()) {
    this.clock = clock
    /** @type {Map<string, {token: string, expiresAt: number, reason: string, workspace: string}>} */
    this.map = new Map()
  }

  /**
   * 授予租约（同键覆盖）。
   * @param {string} key
   * @param {number} ttlMs
   * @param {{reason?: string, workspace?: string}} [meta]
   */
  grant(key, ttlMs, meta = {}) {
    const now = this.clock()
    const lease = {
      token: randomUUID(),
      expiresAt: now + ttlMs,
      reason: String(meta.reason ?? ''),
      workspace: String(meta.workspace ?? ''),
    }
    this.map.set(key, lease)
    return lease
  }

  /** 有效租约；已过期则删除并返回 null。 */
  get(key) {
    const lease = this.map.get(key)
    if (!lease) return null
    if (this.clock() >= lease.expiresAt) {
      this.map.delete(key)
      return null
    }
    return lease
  }

  /** 剩余毫秒（无有效租约返回 0）。 */
  remainingMs(key) {
    const lease = this.get(key)
    return lease ? Math.max(0, lease.expiresAt - this.clock()) : 0
  }

  /** 撤销；返回是否确有租约被撤销。 */
  revoke(key) {
    return this.map.delete(key)
  }

  /** 清空（插件卸载/测试用）。 */
  clear() {
    this.map.clear()
  }
}

/** 会话键：优先 session header id，退化到单个默认键（同机多会话时互不影响）。 */
export function sessionKeyOf(exec) {
  const session = exec?.agent?.session
  const header = session?.header
  const id = header?.id ?? header?.sessionId ?? session?.id
  return id == null ? 'default' : String(id)
}

/** 会话工作区：优先 agent 会话 cwd，回退 process.cwd()（与 tool-fs 同源）。 */
export function workspaceOf(exec) {
  return exec?.agent?.session?.header?.cwd ?? process.cwd()
}

/** 解释器候选表（按平台顺序尝试；可用 --version 探活，结果缓存）。 */
export function interpreterCandidates(language) {
  if (language === 'node') return [[process.execPath, []]]
  if (process.platform === 'win32') return [['python', []], ['py', ['-3']], ['python3', []]]
  return [['python3', []], ['python', []]]
}

const interpreterCache = new Map()

/**
 * 解析可用解释器（探活一次并缓存）。找不到返回 null。
 * @param {'node'|'python'} language
 * @param {(cmd: string, args: string[]) => boolean} [probe]
 */
export function resolveInterpreter(language, probe = defaultProbe) {
  if (interpreterCache.has(language)) return interpreterCache.get(language)
  let found = null
  for (const [cmd, pre] of interpreterCandidates(language)) {
    if (probe(cmd, pre)) {
      found = { cmd, pre }
      break
    }
  }
  interpreterCache.set(language, found)
  return found
}

/** 默认探活：<cmd> <pre...> --version 退出码 0。 */
function defaultProbe(cmd, pre) {
  try {
    const r = spawnSync(cmd, [...pre, '--version'], {
      timeout: 5_000, windowsHide: true, stdio: 'ignore',
    })
    return r.status === 0
  } catch {
    return false
  }
}

/** 清空解释器缓存（安装新解释器后由调用方触发）。 */
export function resetInterpreterCache() {
  interpreterCache.clear()
}

/**
 * 执行一个脚本文件并收集输出（超时强杀；输出截断）。
 * @param {string} cmd
 * @param {string[]} args
 * @param {{cwd: string, env: Record<string,string>, timeoutMs: number}} options
 * @returns {Promise<{exitCode: number|null, timedOut: boolean, stdout: string, stderr: string, truncated: boolean, durationMs: number, spawnError?: string}>}
 */
export function runProcess(cmd, args, options) {
  const { cwd, env, timeoutMs } = options
  return new Promise((resolvePromise) => {
    const startedAt = Date.now()
    let stdout = ''
    let stderr = ''
    let truncated = false
    let timedOut = false
    let settled = false
    let child
    const finish = (result) => {
      if (settled) return
      settled = true
      resolvePromise({ exitCode: null, timedOut, stdout, stderr, truncated, durationMs: Date.now() - startedAt, ...result })
    }
    const append = (target, chunk) => {
      const text = String(chunk)
      const room = MAX_OUTPUT_CHARS - target.length
      if (room <= 0) {
        truncated = true
        return target
      }
      if (text.length > room) truncated = true
      return target + text.slice(0, room)
    }
    try {
      child = spawn(cmd, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      finish({ spawnError: error?.message ?? String(error) })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGKILL') } catch { /* 已退出 */ }
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk) })
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk) })
    child.on('error', (error) => {
      clearTimeout(timer)
      finish({ spawnError: error?.message ?? String(error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish({ exitCode: typeof code === 'number' ? code : null })
    })
  })
}
