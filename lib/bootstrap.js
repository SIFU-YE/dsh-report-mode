/**
 * 报表模式预设的自举安装 + AgentTeams 补丁状态校验。
 *
 * 这个模块是「插件包里带预设」的关键：DSH 的预设发现根固定为
 * `<DSH_HOME>/.agent-presets`（user root，默认开启），而预设行的 `name` 只能解析
 * 内置模块或预设目录内的相对文件——它解析不到本插件包的裸包名。所以预设必须以
 * **数据**的形式落进 user root，而不是让预设反过来引用插件包。
 *
 * 安全性：只接管带本插件印记（.dsh-report-mode.json）的目录。若用户自己在
 * `.agent-presets/report-mode` 下写了预设（没有印记），一律不覆盖。
 * @module dsh-report-mode/bootstrap
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 预设 id 即目录名；必须匹配 DSH 的 PRESET_ID 规则（小写字母数字与连字符）。 */
export const PRESET_ID = 'report-mode'
/** 本插件安装的预设目录里放的印记文件，用来区分「插件装的」和「用户自己写的」。 */
export const PRESET_STAMP = '.dsh-report-mode.json'
/** 补丁基准的上游版本；与 patches/manifest.json 保持一致。 */
export const SUPPORTED_AGENT_TEAMS_VERSION = '0.1.20'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const BUNDLED_PRESET = join(PACKAGE_ROOT, 'presets', PRESET_ID)

/** DSH home：显式环境变量优先，其次 ~/.dsh（与 dsh-home-paths 的默认一致）。 */
export function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

function info(ctx, message) {
  if (typeof ctx?.logger?.info === 'function') ctx.logger.info(message)
  else console.log(`dsh-report-mode: ${message}`)
}

function warn(ctx, message) {
  if (typeof ctx?.logger?.warn === 'function') ctx.logger.warn(message)
  else console.warn(`dsh-report-mode: ${message}`)
}

/**
 * 把随包预设落地到 `<DSH_HOME>/.agent-presets/report-mode`。
 *
 * 幂等：版本一致就什么都不做；只有带本插件印记的旧版本才会被替换。
 * 预设发现每次调用都重读磁盘，所以装完不需要重启进程就能在 roster 里看到。
 * @param ctx - 插件上下文（只用 logger，可缺省）。
 * @param config - 行配置；`presetAutoInstall: false` 可关闭自举。
 * @returns 本次动作摘要，便于测试与诊断。
 */
export function installBundledPreset(ctx, config = {}) {
  if (config.presetAutoInstall === false) return { action: 'disabled' }
  if (!existsSync(BUNDLED_PRESET)) return { action: 'skipped', reason: 'bundle-missing', path: BUNDLED_PRESET }

  const version = readJson(join(PACKAGE_ROOT, 'package.json'))?.version ?? '0.0.0'
  const root = join(dshHome(), '.agent-presets')
  const target = join(root, PRESET_ID)
  const stampFile = join(target, PRESET_STAMP)

  try {
    const exists = existsSync(target)
    const stamp = exists ? readJson(stampFile) : undefined

    if (exists && stamp === undefined) {
      warn(ctx, `预设目录已存在但不是本插件安装的（缺少 ${PRESET_STAMP}），保持原样不覆盖：${target}`)
      return { action: 'skipped', reason: 'foreign-preset', path: target }
    }
    if (exists && stamp.version === version) {
      return { action: 'skipped', reason: 'up-to-date', path: target, version }
    }

    mkdirSync(root, { recursive: true })
    rmSync(target, { recursive: true, force: true })
    cpSync(BUNDLED_PRESET, target, { recursive: true })
    writeFileSync(stampFile, `${JSON.stringify({ source: 'dsh-report-mode', version, installedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8')
    info(ctx, exists ? `报表模式预设已更新到 ${version}：${target}` : `报表模式预设已安装：${target}`)
    return { action: exists ? 'updated' : 'installed', path: target, version }
  } catch (error) {
    warn(ctx, `预设自举失败（报表模式不会出现在预设列表里）：${String(error?.message ?? error)}`)
    return { action: 'error', reason: String(error?.message ?? error), path: target }
  }
}

/**
 * 在 `<DSH_HOME>/profiles/<profile>/node_modules` 里按包名探测安装位置。
 *
 * 先看 hoisted 布局，再看 pnpm 的 `.pnpm/<name>@<version>/node_modules/<name>` 布局；
 * profile 顺序以当前 profile 优先（`DSH_DESKTOP_DEFAULT_PROFILE`），其余按目录名补足。
 * @param packageName - 包名，如 'dsh-report-git' 或 '@nanmicoder/dsh-agent-teams'。
 * @returns 包目录；找不到返回 undefined。
 */
export function locateInProfiles(packageName) {
  const segments = packageName.split('/')
  const storePrefix = `${packageName.replace('/', '+')}@`
  const profilesDir = join(dshHome(), 'profiles')
  const candidates = []
  if (process.env.DSH_DESKTOP_DEFAULT_PROFILE) candidates.push(process.env.DSH_DESKTOP_DEFAULT_PROFILE)
  candidates.push('desktop', 'web', 'default')
  try {
    for (const entry of readdirSync(profilesDir)) if (!candidates.includes(entry)) candidates.push(entry)
  } catch { /* 没有 profiles 目录 */ }

  for (const profile of candidates) {
    const base = join(profilesDir, profile, 'node_modules')
    const hoisted = join(base, ...segments)
    if (existsSync(join(hoisted, 'package.json'))) return hoisted
    // pnpm 非 hoisted 布局兜底
    try {
      for (const entry of readdirSync(join(base, '.pnpm'))) {
        if (!entry.startsWith(storePrefix)) continue
        const nested = join(base, '.pnpm', entry, 'node_modules', ...segments)
        if (existsSync(join(nested, 'package.json'))) return nested
      }
    } catch { /* 没有 .pnpm 目录 */ }
  }
  return undefined
}

/**
 * 定位已安装的 @nanmicoder/dsh-agent-teams。
 *
 * 先走真实模块解析（插件装在 profile 里时最准），失败再按 profile 目录探测：
 * 直接从源码目录跑自检、或包被装在别的 profile 下时会走到回退分支。
 * @returns 包目录；找不到返回 undefined。
 */
export function locateAgentTeams() {
  try {
    return dirname(createRequire(import.meta.url).resolve('@nanmicoder/dsh-agent-teams/package.json'))
  } catch { /* 落到回退探测 */ }
  return locateInProfiles('@nanmicoder/dsh-agent-teams')
}

/**
 * 校验 agent-teams 的落点状态：是否装上、版本是否为基准。
 *
 * 只做诊断与告警，不代替用户执行安装。0.1.3 起预设与执行规范已不再依赖
 * report 补丁的 memory 工具，因此"没打补丁"不再告警；补丁仍保留在 patches/ 里，
 * 需要旧行为的人可按 docs/PATCH.md 自行应用。
 * @param ctx - 插件上下文（只用 logger，可缺省）。
 * @returns 状态摘要。
 */
export function checkAgentTeamsPatch(ctx) {
  const packageDir = locateAgentTeams()
  if (packageDir === undefined) {
    warn(ctx, '未安装 @nanmicoder/dsh-agent-teams：报表模式的 /agent-teams 团队能力不可用。安装：dsh plugin --profile <profile> add @nanmicoder/dsh-agent-teams@0.1.20')
    return { installed: false }
  }

  const version = readJson(join(packageDir, 'package.json'))?.version
  const hasMemoryModule = existsSync(join(packageDir, 'lib', 'memory.js'))

  if (version !== SUPPORTED_AGENT_TEAMS_VERSION) {
    const forkHint = /-/.test(String(version))
      ? '（看起来是本地 fork 版本）若要换成原版，按 docs/INSTALL.md 执行迁移。'
      : `请安装基准版本：dsh plugin --profile <profile> add @nanmicoder/dsh-agent-teams@${SUPPORTED_AGENT_TEAMS_VERSION}`
    warn(ctx, `@nanmicoder/dsh-agent-teams@${version} 不是基准 ${SUPPORTED_AGENT_TEAMS_VERSION}。${forkHint}`)
    return { installed: true, version, patched: hasMemoryModule, unsupportedVersion: true, packageDir }
  }
  return { installed: true, version, patched: hasMemoryModule, packageDir }
}
