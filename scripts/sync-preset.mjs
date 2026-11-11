#!/usr/bin/env node
/**
 * 装配源同步：`presets/report-mode/agent.cordis.yml` → `cordis.patch.yml` 的
 * `preset-report-mode.plugins` 段。
 *
 * 为什么需要它：DSH 0.2.0 起，**真正被挂载的**是 bundle patch 里的预设声明行
 * （`plugin_manager` 的 `patchId` 是 `preset-report-mode`）。`presets/report-mode/`
 * 目录只是同一份内容的镜像。0.1.28 之后连续三次只改了镜像、没同步 patch，导致新
 * persona 从未进入运行中的宿主（"改了提示词但行为不变"）。本脚本把镜像当唯一语义源，
 * patch 由它生成：改完 presets 源跑一次 `node scripts/sync-preset.mjs` 即可。
 *
 * 用法：
 *   node scripts/sync-preset.mjs            # 把 presets 源写入 patch（幂等）
 *   node scripts/sync-preset.mjs --check    # 只比对，不一致打印差异并 exit 1（npm test 用）
 *   node scripts/sync-preset.mjs --root <dir>
 *
 * 约束：
 *   - 只替换 `preset-report-mode` 块里 `plugins:` 的子行；该块以外的内容逐字不动；
 *   - 缩进：`plugins:` 键缩进 + 2 空格（当前 patch 里是 8 → 10）；
 *   - 行尾跟随 patch 现状（本仓库统一 LF，见 .gitattributes）；
 *   - 不做 YAML 解析/重排：patch 的正文与 presets 源逐行一致，只差缩进，任何语义
 *     解析都会引入 diff 噪声，反而让"装配源=镜像"的核对变难。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(
  process.argv.includes('--root') ? process.argv[process.argv.indexOf('--root') + 1] : join(HERE, '..'),
)
const SOURCE_PATH = join(ROOT, 'presets', 'report-mode', 'agent.cordis.yml')
const PATCH_PATH = join(ROOT, 'cordis.patch.yml')
const PRESET_ROW_ID = 'preset-report-mode'
const CHECK = process.argv.includes('--check')

function fail(message) {
  console.error(`\n✗ sync-preset: ${message}\n`)
  process.exit(2)
}

/** 按 patch 现状的行尾切分；返回 { lines, eol, hadFinalNewline }（lines 不含末尾空行伪影）。 */
function readLines(path) {
  const text = readFileSync(path, 'utf8')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const hadFinalNewline = text.endsWith(eol)
  const lines = text.split(/\r?\n/)
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return { lines, eol, hadFinalNewline, text }
}

/** 定位 preset-report-mode 块内 plugins: 的子行区间。 */
function locatePluginsBody(lines) {
  const rowLine = lines.findIndex((line) => new RegExp(`^\\s*-\\s+id:\\s*${PRESET_ROW_ID}\\s*$`).test(line))
  if (rowLine < 0) fail(`cordis.patch.yml 里找不到 "- id: ${PRESET_ROW_ID}" 行`)

  const rowIndent = lines[rowLine].match(/^\s*/)[0].length
  let pluginsLine = -1
  let pluginsIndent = -1
  for (let i = rowLine + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    const indent = line.match(/^\s*/)[0].length
    if (indent <= rowIndent) fail(`"${PRESET_ROW_ID}" 块内没找到 plugins: 键`)
    const match = line.match(/^(\s*)plugins:\s*$/)
    if (match) {
      pluginsLine = i
      pluginsIndent = match[1].length
      break
    }
  }
  if (pluginsLine < 0) fail(`"${PRESET_ROW_ID}" 块内没找到独占一行的 plugins: 键`)

  const bodyIndent = pluginsIndent + 2
  let bodyEnd = pluginsLine + 1
  while (bodyEnd < lines.length) {
    const line = lines[bodyEnd]
    if (line.trim() !== '' && line.match(/^\s*/)[0].length < bodyIndent) break
    bodyEnd += 1
  }
  if (bodyIndent !== 10) {
    // 当前 patch 的 plugins: 在 8 空格，正文 10 空格；变了说明 patch 结构被人改过。
    fail(`plugins: 正文缩进是 ${bodyIndent} 空格，与预期的 10 不符；请先人工核对 cordis.patch.yml 结构`)
  }
  return { pluginsLine, bodyIndent, bodyStart: pluginsLine + 1, bodyEnd }
}

/** presets 源 → patch 正文行（每行加 bodyIndent 前缀；空行保持空）。 */
function renderBody(sourceLines, bodyIndent) {
  const prefix = ' '.repeat(bodyIndent)
  const rendered = sourceLines.map((line) => (line === '' ? '' : prefix + line))
  while (rendered.length && rendered[rendered.length - 1] === '') rendered.pop()
  return rendered
}

function printDiff(current, expected) {
  const max = Math.max(current.length, expected.length)
  let shown = 0
  console.error(`  当前 patch 正文 ${current.length} 行，按镜像应为 ${expected.length} 行`)
  for (let i = 0; i < max && shown < 40; i++) {
    const a = current[i]
    const b = expected[i]
    if (a === b) continue
    console.error(`  - 第 ${i + 1} 行 patch  : ${a === undefined ? '<缺行>' : a.trim().slice(0, 100)}`)
    console.error(`  + 第 ${i + 1} 行 镜像源: ${b === undefined ? '<缺行>' : b.trim().slice(0, 100)}`)
    shown += 1
  }
  if (shown === 0) console.error('  （正文逐行一致）')
  else if (shown === 40) console.error('  … 差异超过 40 行，只显示前 40 行')
}

// ── 主流程 ──────────────────────────────────────────────────────────────────

const source = readLines(SOURCE_PATH)
const patch = readLines(PATCH_PATH)

if (!source.lines.length) fail(`presets 源是空的：${SOURCE_PATH}`)
if (source.text.includes('\r\n') && patch.eol === '\n') {
  console.warn('  ! presets 源是 CRLF，patch 是 LF：正文按 patch 行尾写回（.gitattributes 要求 LF）')
}

const { pluginsLine, bodyIndent, bodyStart, bodyEnd } = locatePluginsBody(patch.lines)
const expected = renderBody(source.lines, bodyIndent)
const current = patch.lines.slice(bodyStart, bodyEnd)
const synced = current.length === expected.length && current.every((line, index) => line === expected[index])

if (CHECK) {
  if (synced) {
    console.log(`  ✓ preset 装配源已同步（${PRESET_ROW_ID}.plugins，${expected.length} 行）`)
    process.exit(0)
  }
  console.error('\n✗ preset 装配源与镜像不一致（cordis.patch.yml 需要重新生成）：')
  console.error('  源：presets/report-mode/agent.cordis.yml')
  printDiff(current, expected)
  console.error('\n  处置：node scripts/sync-preset.mjs，然后把 cordis.patch.yml 一起提交。\n')
  process.exit(1)
}

if (synced) {
  console.log(`  ✓ 已是最新（${PRESET_ROW_ID}.plugins，${expected.length} 行），未改动文件`)
  process.exit(0)
}

const nextLines = [
  ...patch.lines.slice(0, bodyStart),
  ...expected,
  ...patch.lines.slice(bodyEnd),
]
const nextText = nextLines.join(patch.eol) + (patch.hadFinalNewline ? patch.eol : '')
writeFileSync(PATCH_PATH, nextText, 'utf8')
console.log(
  `  ✓ 已同步 presets/report-mode/agent.cordis.yml → cordis.patch.yml` +
    `（${PRESET_ROW_ID}.plugins，${current.length} → ${expected.length} 行）`,
)
