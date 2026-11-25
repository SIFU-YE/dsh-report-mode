#!/usr/bin/env node
/**
 * dsh-report-mode 的 AgentTeams 适配补丁工具（3A 方案的执行器）。
 *
 * 为什么需要它：报表模式对 AgentTeams 的适配有 3 处是结构性改动（命令-only、
 * 队长通知、scoped memory），上游没有对应开关，只能打补丁。为了让「报表模式
 * 仓库里不放一份完整 fork」，这里只放一个补丁文件 + 这个执行器。
 *
 * 为什么不用 `git apply`：
 * 1. 上游 npm 包里的 `lib/*.js` 是 **CRLF** 行尾，而补丁是 LF，直接打会因行尾不匹配失败；
 * 2. 更隐蔽的是，`git apply` 在**有仓库上下文**的目录里行为会变——当时的真实事故是
 *    用户主目录被 `git init` 成了一个 worktree = 整个主目录的仓库，于是 `%TEMP%`
 *    之类的路径也落在该仓库内，`git apply` 会直接输出 "Skipped patch" 并且
 *    **静默地什么都不做**（退出码 0）。这会让"补丁已应用"变成假象。
 * 因此这里自带一个最小 unified-diff 应用器：不依赖 git、不受仓库上下文影响、
 * 行尾在内存里归一化后再按目标原样写回，且每一步都有哈希校验兜底。
 *
 * 版本锁：打补丁前比对目标文件归一化 sha256 与 manifest 的 preImage；上游一发新版
 * 就拒绝执行并报出差异，绝不"尽力而为"地把改动盖掉。
 *
 * 用法：
 *   node tools/apply-patch.mjs --profile desktop [--mode check|apply|verify|revert]
 *   node tools/apply-patch.mjs --package-dir <path to @nanmicoder/dsh-agent-teams>
 * 缺省 mode = check（只体检，不改任何文件）。--dry-run 可配合 apply 做无副作用演练。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = resolve(TOOLS_DIR, '..')
const MANIFEST_PATH = join(PACKAGE_ROOT, 'patches', 'manifest.json')

// ── 输出 ────────────────────────────────────────────────────────────────────

const die = (message) => {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}
const ok = (message) => console.log(`  ✓ ${message}`)
const info = (message) => console.log(`  · ${message}`)

// ── 基础 ────────────────────────────────────────────────────────────────────

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) die(`找不到补丁清单：${MANIFEST_PATH}`)
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
}

/** 归一化行尾后再哈希：上游包是 CRLF，补丁基准按 LF 计算。 */
function normalizeHash(text) {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex')
}
const hashFile = (file) => normalizeHash(readFileSync(file, 'utf8'))

const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n')
const toEol = (text, eol) => (eol === '\r\n' ? text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n') : text.replace(/\r\n/g, '\n'))

// ── 最小 unified-diff 应用器 ────────────────────────────────────────────────

/**
 * 解析补丁文本为每个文件的 hunk 列表。
 * @param patch - 补丁全文（LF）。
 * @returns 文件段数组：{ path, isNew, hunks:[{oldStart,oldCount,newStart,newCount,lines}] }
 */
export function parsePatch(patch) {
  const files = []
  // 逐行剥掉可能存在的 CR：仓库在本机是 core.autocrlf=true 检出的，clone 到 Windows
  // 时 .patch 可能变成 CRLF；若不剥，hunk 内容会带上尾随 \r 而与目标文件失配。
  const rawLines = patch.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
  // 补丁文件以换行结尾时 split 会多出一个空元素；它不是 hunk 内容
  // （unified diff 里"空上下文行"写作单个空格，不会是空串）。
  if (rawLines[rawLines.length - 1] === '') rawLines.pop()
  let current = null
  let hunk = null
  for (const raw of rawLines) {
    if (raw.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw)
      if (match === null) die(`无法解析补丁的文件头：${raw}`)
      current = { path: match[2], isNew: false, hunks: [] }
      files.push(current)
      hunk = null
      continue
    }
    if (current === null) continue
    if (raw.startsWith('new file mode')) {
      current.isNew = true
      continue
    }
    if (raw.startsWith('--- ') || raw.startsWith('+++ ') || raw.startsWith('index ') || raw.startsWith('old mode') || raw.startsWith('new mode')) continue
    if (raw.startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw)
      if (match === null) die(`无法解析补丁的 hunk 头：${raw}`)
      hunk = {
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
      }
      current.hunks.push(hunk)
      continue
    }
    if (hunk !== null) hunk.lines.push(raw)
  }
  return files
}

/** 反向应用用：把 hunk 的增删与新旧起点对调。 */
function reverseHunks(hunks) {
  return hunks.map((h) => ({
    oldStart: h.newStart,
    oldCount: h.newCount,
    newStart: h.oldStart,
    newCount: h.oldCount,
    lines: h.lines.map((line) => (line.startsWith('+') ? `-${line.slice(1)}` : line.startsWith('-') ? `+${line.slice(1)}` : line)),
  }))
}

/**
 * 把一个文件的 hunk 应用到文本上。
 * @param text - 目标文本（LF）。
 * @param file - parsePatch 的文件段；isNew 时 text 传空串。
 * @param reverse - 反向应用（回退）。
 * @returns 应用后的文本（LF）。
 */
export function applyFileHunks(text, file, reverse = false) {
  const hunks = reverse ? reverseHunks(file.hunks) : file.hunks
  const lines = file.isNew ? [] : text.split('\n')
  const out = []
  let pos = 0
  for (const hunk of hunks) {
    const start = Math.max(0, hunk.oldStart - 1)
    if (start < pos) die(`${file.path}: hunk 顺序异常（起点 ${hunk.oldStart} 早于已处理位置）`)
    out.push(...lines.slice(pos, start))
    pos = start
    for (const line of hunk.lines) {
      const marker = line[0]
      const body = line.slice(1)
      if (marker === ' ' || marker === '-') {
        if (lines[pos] !== body) {
          die(`${file.path}: hunk 上下文不匹配（第 ${pos + 1} 行）\n  期望 ${JSON.stringify(body)}\n  实际 ${JSON.stringify(lines[pos])}\n上游很可能已改动此处，请按 docs/PATCH.md 重新生成补丁。`)
        }
        if (marker === ' ') out.push(body)
        pos += 1
      } else if (marker === '+') {
        out.push(body)
      } else if (marker === '\\') {
        // "\ No newline at end of file"：本补丁不产生该情形，忽略即可。
      } else {
        die(`${file.path}: 无法识别的 hunk 行：${JSON.stringify(line)}`)
      }
    }
  }
  out.push(...lines.slice(pos))
  return file.isNew ? `${out.join('\n')}\n` : out.join('\n')
}

/** 按补丁产出每个目标文件的完整内容（LF），并逐文件比对 postImage 哈希。 */
function buildPatchedContent(target, manifest, reverse = false) {
  const patchPath = join(PACKAGE_ROOT, 'patches', manifest.patch)
  if (!existsSync(patchPath)) die(`找不到补丁文件：${patchPath}`)
  const files = parsePatch(readFileSync(patchPath, 'utf8'))

  const result = new Map()
  for (const file of files) {
    if (reverse) {
      if (file.isNew) continue
      const source = join(target, file.path)
      if (!existsSync(source)) die(`回退时缺少文件：${file.path}`)
      result.set(file.path, applyFileHunks(readFileSync(source, 'utf8').replace(/\r\n/g, '\n'), file, true))
      continue
    }
    if (!file.isNew) {
      const source = join(target, file.path)
      if (!existsSync(source)) die(`目标缺少待补丁文件：${file.path}`)
      result.set(file.path, applyFileHunks(readFileSync(source, 'utf8').replace(/\r\n/g, '\n'), file))
      continue
    }
    result.set(file.path, applyFileHunks('', file))
  }

  if (!reverse) {
    for (const [rel, expected] of Object.entries(manifest.postImage)) {
      const actual = result.get(rel)
      if (actual === undefined) die(`补丁没有覆盖预期产物：${rel}`)
      const hash = normalizeHash(actual)
      if (hash !== expected) die(`补丁产物与预期不符：${rel}\n  实际 ${hash}\n  预期 ${expected}`)
    }
  }
  return result
}

// ── 定位与状态 ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const eq = token.indexOf('=')
    if (eq !== -1) {
      out[token.slice(2, eq)] = token.slice(eq + 1)
      continue
    }
    const key = token.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next
      i += 1
    } else out[key] = true
  }
  return out
}

function locatePackageDir(argv) {
  if (typeof argv['package-dir'] === 'string' && argv['package-dir'] !== '') return resolve(argv['package-dir'])
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  const profile = typeof argv.profile === 'string' && argv.profile !== ''
    ? argv.profile
    : (process.env.DSH_DESKTOP_DEFAULT_PROFILE || 'desktop')
  return join(home, 'profiles', profile, 'node_modules', '@nanmicoder', 'dsh-agent-teams')
}

function inspect(packageDir, manifest) {
  if (!existsSync(join(packageDir, 'package.json'))) {
    return { state: 'missing', detail: `目标包不存在：${packageDir}`, packageDir }
  }
  const installed = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')).version
  if (installed !== manifest.version) {
    return { state: 'unknown-version', detail: `已安装 ${installed}，补丁基准是 ${manifest.version}`, packageDir }
  }
  const matches = (map) => Object.entries(map).every(([rel, hash]) => existsSync(join(packageDir, rel)) && hashFile(join(packageDir, rel)) === hash)
  if (matches(manifest.postImage)) return { state: 'patched', detail: `已应用 dsh-report-mode 补丁（基准 ${manifest.version}）`, packageDir }
  if (matches(manifest.preImage)) return { state: 'pristine', detail: `原版未打补丁（${manifest.version}）`, packageDir }
  const drifted = [...new Set([...Object.keys(manifest.preImage), ...Object.keys(manifest.postImage)])]
    .filter((rel) => existsSync(join(packageDir, rel)) && hashFile(join(packageDir, rel)) !== manifest.preImage[rel] && hashFile(join(packageDir, rel)) !== manifest.postImage[rel])
  return { state: 'drifted', detail: `文件内容与补丁基准都不一致（被改过或上游已变动）：${drifted.join(', ') || '待人工确认'}`, packageDir }
}

// ── 动作 ────────────────────────────────────────────────────────────────────

function applyPatch(target, dryRun) {
  const manifest = readManifest()
  const before = inspect(target, manifest)
  if (before.state === 'patched') {
    ok(`已经打过补丁，无需重复应用（${target}）`)
    return
  }
  if (before.state !== 'pristine') {
    die(`${before.detail}\n拒绝打补丁。请先恢复原版：dsh plugin --profile <profile> install，或 add @nanmicoder/dsh-agent-teams@${manifest.version}`)
  }
  const content = buildPatchedContent(target, manifest)
  if (dryRun) {
    ok('干跑通过：补丁可应用，且全部产物哈希匹配（未改动任何文件）')
    return
  }
  const eols = new Map()
  for (const rel of Object.keys(manifest.preImage)) eols.set(rel, eolOf(readFileSync(join(target, rel), 'utf8')))
  for (const [rel, lf] of content) {
    const abs = join(target, rel)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, toEol(lf, eols.get(rel) ?? '\n'), 'utf8')
  }
  const after = inspect(target, manifest)
  if (after.state !== 'patched') die(`写回后校验失败：${after.detail}`)
  ok(`补丁已应用：${target}`)
  ok('命令-only / 队长通知 / scoped memory 三处改动就位；重启 DSH 后生效')
}

function revertPatch(target, dryRun) {
  const manifest = readManifest()
  const before = inspect(target, manifest)
  if (before.state === 'pristine') {
    ok('本来就是原版，无需回退')
    return
  }
  if (before.state !== 'patched') die(`${before.detail}\n无法安全回退，请重新安装该包。`)
  const content = buildPatchedContent(target, manifest, true)
  if (dryRun) {
    ok('回退干跑通过（未改动任何文件）')
    return
  }
  for (const [rel, lf] of content) {
    const abs = join(target, rel)
    writeFileSync(abs, toEol(lf, eolOf(readFileSync(abs, 'utf8'))), 'utf8')
  }
  rmSync(join(target, 'lib', 'memory.js'), { force: true })
  const after = inspect(target, manifest)
  if (after.state !== 'pristine') die(`回退后校验失败：${after.detail}`)
  ok(`补丁已回退，目标包恢复原版：${target}`)
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

const argv = parseArgs(process.argv.slice(2))
const manifest = readManifest()
const target = locatePackageDir(argv)
const mode = typeof argv.mode === 'string' ? argv.mode : 'check'
const dryRun = argv['dry-run'] === true

console.log('\ndsh-report-mode · AgentTeams 补丁工具')
console.log(`  目标：${target}`)
console.log(`  基准：${manifest.base}@${manifest.version}   模式：${mode}${dryRun ? '（干跑）' : ''}\n`)

const status = inspect(target, manifest)
switch (mode) {
  case 'check':
    if (status.state === 'patched') ok(status.detail)
    else if (status.state === 'pristine') info(`${status.detail} —— 执行 --mode apply 应用`)
    else die(status.detail)
    break
  case 'verify':
    if (status.state !== 'patched') die(`补丁未生效：${status.detail}`)
    ok(status.detail)
    ok('三个 memory 工具与队长通知的代码落点齐全')
    break
  case 'apply':
    applyPatch(target, dryRun)
    break
  case 'revert':
    revertPatch(target, dryRun)
    break
  default:
    die(`未知模式：${mode}（可用：check / verify / apply / revert）`)
}

console.log('')
